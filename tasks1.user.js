// ==UserScript==
// @name        MTurk Task - Local Python Multi-Server API (No Firebase)
// @namespace   Violentmonkey Scripts
// @match       https://worker.mturk.com/projects/*/tasks/*
// @grant       GM_xmlhttpRequest
// @connect     localhost
// @connect     192.227.99.48
// @connect     *
// @version     4.1
// @updateURL   https://github.com/mavericpartha/lokesh/raw/refs/heads/main/Tasks.user.js
// @downloadURL https://github.com/mavericpartha/lokesh/raw/refs/heads/main/Tasks.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ---- CHANGE THIS to your Python server's IP if MTurk runs on a different machine ----
  const API_BASE = "http://192.227.99.48:8000";
  const TIMER_STATE_PREFIX = "mturk_hit_timer_state::";

  let currentServer = null;
  let workerToUser = {};
  let userToWorkers = {};

  // --- API helpers ---

  function api(method, path, body) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === "function") {
        GM_xmlhttpRequest({
          method: method,
          url: API_BASE + path,
          headers: { "Content-Type": "application/json" },
          data: body !== undefined ? JSON.stringify(body) : undefined,
          responseType: "json",
          timeout: 15000,
          onload: function(resp) {
            if (resp.status >= 200 && resp.status < 300) {
              let data = resp.response;
              if (typeof data === "string") { try { data = JSON.parse(data); } catch(_){} }
              resolve(data);
            } else {
              reject(new Error("API " + resp.status + ": " + (resp.responseText || "").slice(0, 200)));
            }
          },
          onerror: function(resp) {
            reject(new Error("Connection failed to " + API_BASE + path + " - Is the Python server running?"));
          },
          ontimeout: function() {
            reject(new Error("Timeout connecting to " + API_BASE + path));
          }
        });
      } else {
        fetch(API_BASE + path, {
          method: method,
          headers: { "Content-Type": "application/json" },
          body: body !== undefined ? JSON.stringify(body) : undefined
        })
        .then(function(r) {
          if (!r.ok) throw new Error("API " + r.status);
          return r.json();
        })
        .then(resolve)
        .catch(reject);
      }
    });
  }

  // --- DOM helpers ---

  function getWorkerId() {
    const el = document.querySelector(".me-bar span.text-uppercase span");
    if (!el) return null;
    const txt = el.textContent.replace(/^Copied/i, "").trim();
    const match = txt.match(/A[A-Z0-9]{12,}/);
    return match ? match[0] : txt;
  }

  // --- Auto-detect server + load user map ---

  async function detectServerAndLoadMap() {
    const workerId = getWorkerId();
    if (!workerId) {
      console.warn("[AB2] Could not read worker ID from page");
      return;
    }
    try {
      const det = await api("GET", "/api/detect-server?workerId=" + encodeURIComponent(workerId));
      currentServer = det.server;
      console.log("[AB2] Detected server:", currentServer, "for worker:", workerId);
    } catch (err) {
      console.warn("[AB2] Server detection failed, defaulting to server1:", err.message || err);
      currentServer = "server1";
    }
    try {
      const data = await api("GET", "/api/user-map?server=" + currentServer);
      workerToUser = data.workerToUser || {};
      userToWorkers = data.userToWorkers || {};
      console.log("[AB2] Loaded user map for", currentServer + ":", Object.keys(workerToUser).length, "entries");
    } catch (err) {
      console.error("[AB2] Failed to load user map:", err.message || err);
    }
  }

  // --- More DOM helpers ---

  function parseReward() {
    let reward = 0.0;
    const label = Array.from(document.querySelectorAll(".detail-bar-label"))
      .find(el => el.textContent.includes("Reward"));
    if (label) {
      const valEl = label.nextElementSibling;
      if (valEl) {
        const match = valEl.innerText.match(/\$([0-9.]+)/);
        if (match) reward = parseFloat(match[1]);
      }
    }
    return reward;
  }

  function parseDurationToSeconds(raw) {
    const text = String(raw || "").toLowerCase();
    let total = 0;
    const day = text.match(/(\d+)\s*(day|days|d)\b/);
    const hr  = text.match(/(\d+)\s*(hour|hours|hr|hrs|h)\b/);
    const min = text.match(/(\d+)\s*(minute|minutes|min|mins|m)\b/);
    const sec = text.match(/(\d+)\s*(second|seconds|sec|secs|s)\b/);
    if (day) total += parseInt(day[1], 10) * 86400;
    if (hr)  total += parseInt(hr[1], 10)  * 3600;
    if (min) total += parseInt(min[1], 10) * 60;
    if (sec) total += parseInt(sec[1], 10);
    return total || null;
  }

  function parseTimeAllottedSeconds() {
    const label = Array.from(document.querySelectorAll(".detail-bar-label"))
      .find(el => /time\s*allotted/i.test(el.textContent || ""));
    if (!label) return null;
    const valEl = label.nextElementSibling;
    if (!valEl) return null;
    return parseDurationToSeconds(valEl.innerText || valEl.textContent || "");
  }

  function collectTaskHit() {
    const assignmentId = new URLSearchParams(window.location.search).get("assignment_id");
    if (!assignmentId) return null;

    const workerId = getWorkerId();
    const user = workerToUser[workerId] || "Unknown";

    return {
      assignmentId,
      server: currentServer,
      workerId,
      user,
      requester: document.querySelector(".detail-bar-value a[href*='/requesters/']")?.innerText || "",
      title: document.querySelector(".task-project-title")?.innerText || document.title,
      reward: parseReward(),
      timeAllottedSeconds: parseTimeAllottedSeconds(),
      acceptedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      url: window.location.href,
      status: "active"
    };
  }

  // --- Messaging (scoped to currentServer) ---

  async function sendLiveMessageToAllUsers(text, hit) {
    const fromId = hit.workerId || "UNKNOWN";
    const data = await api("POST", "/api/messages", { fromId, text, server: currentServer });
    return data.sent || 0;
  }

  async function sendLiveMessageToUserNumber(userNumber, text, hit) {
    const fromId = hit.workerId || "UNKNOWN";
    const data = await api("POST", "/api/messages", {
      fromId, text, server: currentServer,
      toUserNumber: String(userNumber).trim()
    });
    return data.sent || 0;
  }

  // --- Timer state (localStorage) ---

  function getTimerStateKey(assignmentId) {
    return TIMER_STATE_PREFIX + assignmentId;
  }

  function loadTimerState(assignmentId) {
    try {
      const raw = localStorage.getItem(getTimerStateKey(assignmentId));
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function saveTimerState(assignmentId, state) {
    try {
      localStorage.setItem(getTimerStateKey(assignmentId), JSON.stringify(state));
    } catch (_) {}
  }

  // --- Timer alert dialog ---

  function showTimeAlertDialog(hit, state, elapsedSec, maxSec, onSnooze, onIgnore) {
    const old = document.getElementById("ab2-time-alert");
    if (old) old.remove();

    const pct = Math.round((elapsedSec / maxSec) * 100);
    const overlay = document.createElement("div");
    overlay.id = "ab2-time-alert";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:2147483647;display:flex;align-items:center;justify-content:center;";

    const box = document.createElement("div");
    box.style.cssText = "width:560px;max-width:92vw;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:12px;padding:16px;font-family:Arial,sans-serif;";
    box.innerHTML =
      "<div style='font-size:18px;font-weight:700;margin-bottom:8px;'>HIT Timer Alert [" + (currentServer || "?") + "]</div>" +
      "<div style='font-size:13px;line-height:1.45;margin-bottom:10px;'>" +
        "Assignment: <b>" + hit.assignmentId + "</b><br>" +
        "Title: " + (hit.title || "Untitled HIT") + "<br>" +
        "Elapsed: " + Math.round(elapsedSec) + "s of " + Math.round(maxSec) + "s (" + pct + "%)" +
      "</div>" +
      "<textarea id='ab2-alert-msg' style='width:100%;height:90px;border-radius:8px;border:1px solid #475569;background:#020617;color:#e2e8f0;padding:8px;'>HIT timer alert: Assignment " + hit.assignmentId + " reached " + pct + "% of max time.</textarea>" +
      "<div style='margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;'>" +
        "<label style='font-size:12px;'>User number:</label>" +
        "<input id='ab2-target-user' type='text' placeholder='e.g. 226' style='width:140px;border-radius:8px;border:1px solid #475569;background:#020617;color:#e2e8f0;padding:8px;' />" +
        "<button id='ab2-sendone-btn' style='padding:8px 12px;border:0;border-radius:8px;background:#0ea5e9;color:#fff;cursor:pointer;'>Send to Specific User</button>" +
      "</div>" +
      "<div style='display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;'>" +
        "<button id='ab2-snooze-btn' style='padding:8px 12px;border:0;border-radius:8px;background:#2563eb;color:#fff;cursor:pointer;'>Snooze (+10%)</button>" +
        "<button id='ab2-ignore-btn' style='padding:8px 12px;border:0;border-radius:8px;background:#dc2626;color:#fff;cursor:pointer;'>Ignore</button>" +
        "<button id='ab2-sendall-btn' style='padding:8px 12px;border:0;border-radius:8px;background:#16a34a;color:#fff;cursor:pointer;'>Send Message to All</button>" +
        "<button id='ab2-close-btn' style='padding:8px 12px;border:0;border-radius:8px;background:#475569;color:#fff;cursor:pointer;'>Close</button>" +
      "</div>" +
      "<div id='ab2-alert-status' style='margin-top:10px;font-size:12px;color:#93c5fd;'></div>";

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const statusEl = box.querySelector("#ab2-alert-status");
    let dialogClosed = false;
    let autoCloseTimer = null;

    function closeDialogForCurrentAlertOnly() {
      if (dialogClosed) return;
      dialogClosed = true;
      state.nextThresholdPct = Math.min((state.nextThresholdPct || 0.5) + 0.1, 5);
      state.dialogOpen = false;
      saveTimerState(hit.assignmentId, state);
      if (autoCloseTimer) { clearTimeout(autoCloseTimer); autoCloseTimer = null; }
      overlay.remove();
    }

    function closeDialogOnly() {
      if (dialogClosed) return;
      dialogClosed = true;
      state.dialogOpen = false;
      saveTimerState(hit.assignmentId, state);
      if (autoCloseTimer) { clearTimeout(autoCloseTimer); autoCloseTimer = null; }
      overlay.remove();
    }

    box.querySelector("#ab2-snooze-btn").onclick = function () {
      onSnooze();
      closeDialogOnly();
    };
    box.querySelector("#ab2-ignore-btn").onclick = function () {
      onIgnore();
      closeDialogOnly();
    };
    box.querySelector("#ab2-close-btn").onclick = function () {
      closeDialogForCurrentAlertOnly();
    };
    box.querySelector("#ab2-sendall-btn").onclick = async function () {
      try {
        const txt = (box.querySelector("#ab2-alert-msg").value || "").trim();
        if (!txt) return;
        statusEl.textContent = "Sending to all users on " + currentServer + "...";
        const n = await sendLiveMessageToAllUsers(txt, hit);
        statusEl.textContent = "Sent to " + n + " users.";
      } catch (e) {
        statusEl.textContent = "Send failed: " + (e && e.message ? e.message : e);
      }
    };
    box.querySelector("#ab2-sendone-btn").onclick = async function () {
      try {
        const txt = (box.querySelector("#ab2-alert-msg").value || "").trim();
        const userNo = (box.querySelector("#ab2-target-user").value || "").trim();
        if (!txt) return;
        statusEl.textContent = "Sending to user " + userNo + " on " + currentServer + "...";
        const n = await sendLiveMessageToUserNumber(userNo, txt, hit);
        statusEl.textContent = "Sent to " + n + " user worker(s).";
      } catch (e) {
        statusEl.textContent = "Send failed: " + (e && e.message ? e.message : e);
      }
    };

    autoCloseTimer = setTimeout(() => {
      closeDialogForCurrentAlertOnly();
    }, 10000);
  }

  // --- Time monitor ---

  function startTimeMonitor(hit) {
    if (!hit || !hit.assignmentId || !hit.timeAllottedSeconds || hit.timeAllottedSeconds <= 0) return;
    let state = loadTimerState(hit.assignmentId);
    if (!state) {
      state = {
        acceptedAt: hit.acceptedAt,
        nextThresholdPct: 0.5,
        ignored: false,
        dialogOpen: false
      };
      saveTimerState(hit.assignmentId, state);
    }

    const tick = () => {
      if (state.ignored) return;
      const acceptedMs = new Date(state.acceptedAt).getTime();
      if (!acceptedMs) return;
      const elapsedSec = Math.max(0, (Date.now() - acceptedMs) / 1000);
      const pct = elapsedSec / hit.timeAllottedSeconds;
      if (pct >= state.nextThresholdPct && !state.dialogOpen) {
        state.dialogOpen = true;
        saveTimerState(hit.assignmentId, state);
        showTimeAlertDialog(
          hit, state, elapsedSec, hit.timeAllottedSeconds,
          () => {
            state.nextThresholdPct = Math.min(state.nextThresholdPct + 0.1, 5);
            state.dialogOpen = false;
            saveTimerState(hit.assignmentId, state);
          },
          () => {
            state.ignored = true;
            state.dialogOpen = false;
            saveTimerState(hit.assignmentId, state);
          }
        );
      }
    };

    tick();
    setInterval(tick, 5000);
  }

  // --- Post task ---

  async function postTask(hit) {
    if (!hit) hit = collectTaskHit();
    if (!hit) return;
    try {
      const resp = await api("POST", "/api/hits", hit);
      console.log("[AB2] Posted HIT:", hit.assignmentId, "Server:", resp.server, "User:", hit.user, "Reward:", hit.reward);
    } catch (err) {
      console.warn("[AB2] Failed to post HIT:", err.message || err);
    }
  }

  // --- Initialize ---

  window.addEventListener("load", async () => {
    console.log("[AB2] Connecting to API at", API_BASE);
    await detectServerAndLoadMap();
    const hit = collectTaskHit();
    await postTask(hit);
    startTimeMonitor(hit);

    try {
      const recentHits = await api("GET", "/api/hits?server=" + currentServer);
      console.log("[AB2] Recent hits on", currentServer, "(last 24h):", recentHits.length);
    } catch (err) {
      console.warn("[AB2] 24h hits read failed:", err.message || err);
    }
  });

  window.__AB2__ = Object.assign({}, window.__AB2__ || {}, {
    api,
    detectServerAndLoadMap,
    getCurrentServer: () => currentServer
  });
})();
