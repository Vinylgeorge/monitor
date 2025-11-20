// ==UserScript==
// @name         🔒 MTurk Earnings Report
// @namespace    ab2soft.secure
// @version      7.0
// @match        https://worker.mturk.com/earnings*
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(async () => {
  'use strict';

  // -------------------------
  // CONFIG
  // -------------------------
  const SHEET_CSV = 'https://docs.google.com/spreadsheets/d/1Ytmr7dHSAv69N27uZcrhKaEerL8WhzMCI02vugq_C_M/export?format=csv&gid=0';
  const FIREBASE_APP_JS = 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
  const FIRESTORE_JS = 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

  const FIREBASE_CFG = {
    apiKey: "AIzaSyCCtBCAJvQCDj8MXb2w90qYUqRrENIIGIQ",
    authDomain: "mturk-monitordeep.firebaseapp.com",
    projectId: "mturk-monitordeep",
    storageBucket: "mturk-monitordeep.firebasestorage.app",
    messagingSenderId: "58392297487",
    appId: "1:58392297487:web:1365ad12110ffd0586637a"
  };

  const PASS_HASH_HEX =
    "9b724d9df97a91d297dc1c714a3987338ebb60a2a53311d2e382411a78b9e07d";

  // -------------------------
  // HELPERS
  // -------------------------
  const sha256hex = async (text) => {
    const enc = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest("SHA-256", enc);
    return [...new Uint8Array(hash)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  };

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const safeJSONParse = (s) => {
    try {
      return JSON.parse(s.replace(/&quot;/g, '"'));
    } catch {
      return null;
    }
  };

  // -------------------------
  // VALUE VALIDATION
  // -------------------------
  function isValid(v) {
    if (!v) return false;
    if (v === "unknown") return false;
    return true;
  }

  // -------------------------
  // EXTRACTORS
  // -------------------------
  function getWorkerId() {
    const el = $$("[data-react-props]").find((e) =>
      e.getAttribute("data-react-props")?.includes("textToCopy")
    );
    if (el) {
      const j = safeJSONParse(el.getAttribute("data-react-props"));
      if (j?.textToCopy) return j.textToCopy.trim();
    }
    return $(".me-bar .text-uppercase span")?.textContent.trim() || "";
  }

  function extractNextTransferInfo() {
    const strongTag = $$("strong").find((el) =>
      /transferred to your/i.test(el.textContent)
    );

    let bankAccount = "",
      nextTransferDate = "";

    if (strongTag) {
      const link =
        strongTag.querySelector("a[href*='direct_deposit']") ||
        strongTag.querySelector(
          "a[href*='amazon.com/gp/css/gc/balance']"
        );

      if (link) {
        if (/amazon\.com/i.test(link.href))
          bankAccount = "Amazon Gift Card Balance";
        else if (/direct_deposit/i.test(link.href))
          bankAccount = link.textContent.trim();
        else bankAccount = link.textContent.trim();
      }

      const txt = strongTag.textContent.replace(/\s+/g, " ");
      const m = txt.match(
        /on\s+([A-Za-z]{3,}\s+\d{1,2},\s+\d{4})/
      );
      if (m) nextTransferDate = m[1].trim();
    }

    return { bankAccount, nextTransferDate };
  }

  function computeLastMonth(body) {
    if (!Array.isArray(body)) return "0.00";

    const now = new Date();
    const startM = new Date(now.getFullYear(), now.getMonth(), 1);
    const startL = new Date(startM.getFullYear(), startM.getMonth() - 1, 1);
    const endL = new Date(startM.getFullYear(), startM.getMonth(), 0);

    let total = 0;
    for (const t of body) {
      const ds = t.requestedDate?.trim();
      if (!ds) continue;
      const [mm, dd, yy] = ds.split("/").map((n) => parseInt(n, 10));
      if (!mm || !dd || !yy) continue;

      const y = yy < 100 ? yy + 2000 : yy;
      const d = new Date(y, mm - 1, dd);

      if (d >= startL && d <= endL)
        total += parseFloat(t.amountRequested || 0);
    }
    return total.toFixed(2);
  }

  async function extractData() {
    const html = document.body.innerHTML.replace(/\s+/g, " ");

    const workerId = getWorkerId();
    const userName =
      $(".me-bar a[href='/account']")?.textContent.trim() || "";

    const currentEarnings =
      (html.match(/Current Earnings:\s*\$([\d.]+)/i) || [])[1] || "";

    let lastTransferAmount = "",
      lastTransferDate = "",
      lastMonth = "0.00";

    try {
      const el = $$("[data-react-class]").find((e) =>
        e.getAttribute("data-react-class")?.includes("TransferHistoryTable")
      );
      if (el) {
        const p = safeJSONParse(el.getAttribute("data-react-props"));
        const body = p?.bodyData || [];
        if (body.length > 0) {
          lastTransferAmount = body[0].amountRequested || "";
          lastTransferDate = body[0].requestedDate || "";
        }
        lastMonth = computeLastMonth(body);
      }
    } catch {}

    const { bankAccount, nextTransferDate } = extractNextTransferInfo();

    let ip = "unknown";
    try {
      ip = (
        await fetch("https://api.ipify.org?format=json").then((r) =>
          r.json()
        )
      ).ip;
    } catch {}

    return {
      workerId,
      userName,
      currentEarnings,
      lastTransferAmount,
      lastTransferDate,
      nextTransferDate,
      bankAccount,
      ip,
      lastMonth,
    };
  }

  // -------------------------
  // GOOGLE SHEET MAP
  // -------------------------
  async function loadSheetMap() {
    try {
      const txt = await (
        await fetch(SHEET_CSV, { cache: "no-store" })
      ).text();

      const rows = txt.split(/\r?\n/).filter(Boolean).map((r) => r.split(","));

      const header = rows.shift().map((h) => h.trim());
      const wi = header.findIndex((h) => /worker.?id/i.test(h));
      const ui = header.findIndex((h) => /user|name/i.test(h));

      const out = {};

      for (const r of rows) {
        const w = (r[wi] || "").trim();
        const u = (r[ui] || "").trim();
        if (w && u) out[w] = u;
      }
      return out;
    } catch {
      return {};
    }
  }

  // -------------------------
  // PASSWORD CHECK
  // -------------------------
  async function ensurePassword(workerId) {
    const key = `verified_${workerId}`;
    const ok = await GM_getValue(key, false);

    if (ok) return;

    const pw = prompt(`🔒 Enter password for WorkerID ${workerId}:`);
    if (!pw) throw "no password";

    const hash = await sha256hex(pw.trim());
    if (hash !== PASS_HASH_HEX) {
      alert("❌ Incorrect password");
      throw "bad password";
    }

    await GM_setValue(key, true);
  }

  function toast(t) {
    const n = document.createElement("div");
    n.textContent = t;

    Object.assign(n.style, {
      position: "fixed",
      right: "16px",
      bottom: "16px",
      background: "#111",
      color: "#fff",
      padding: "8px 12px",
      borderRadius: "8px",
      zIndex: 99999,
    });

    document.body.appendChild(n);
    setTimeout(
      () => location.assign("https://worker.mturk.com/tasks/"),
      2500
    );
  }

  // -------------------------
  // INIT FIREBASE
  // -------------------------
  const { initializeApp } = await import(FIREBASE_APP_JS);
  const { getFirestore, doc, getDoc, setDoc } = await import(FIRESTORE_JS);

  const app = initializeApp(FIREBASE_CFG);
  const db = getFirestore(app);

  // -------------------------
  // MAIN
  // -------------------------
  const data = await extractData();
  if (!data.workerId) {
    toast("⚠️ No Worker ID");
    return;
  }

  await ensurePassword(data.workerId);

  const sheetMap = await loadSheetMap();
  if (sheetMap[data.workerId]) data.userName = sheetMap[data.workerId];

  const ref = doc(db, "earnings_logs", data.workerId);
  const prevSnap = await getDoc(ref);
  const old = prevSnap.exists() ? prevSnap.data() : {};

  // -------------------------
  // MERGE: KEEP ONLY VALID VALUES
  // -------------------------
  function keep(oldVal, newVal) {
    if (!isValid(newVal)) return oldVal ?? "";
    return newVal;
  }

  const finalData = {
    workerId: data.workerId,
    user: keep(old.user, data.userName),
    currentEarnings: keep(old.currentEarnings, data.currentEarnings),
    lastTransferAmount: keep(old.lastTransferAmount, data.lastTransferAmount),
    lastTransferDate: keep(old.lastTransferDate, data.lastTransferDate),
    nextTransferDate: keep(old.nextTransferDate, data.nextTransferDate),
    bankAccount: keep(old.bankAccount, data.bankAccount),
    ip: keep(old.ip, data.ip),
    lastMonthEarnings: keep(old.lastMonthEarnings, data.lastMonth),
    timestamp: new Date().toLocaleString("en-US", {
      timeZone: "Asia/Kolkata",
    }),
    alert: "✅ OK",
  };

  // -------------------------
  // TRUE MISMATCH CHECK
  // -------------------------
  if (prevSnap.exists()) {
    function changed(field) {
      const newVal = finalData[field];
      const oldVal = old[field];

      if (!isValid(newVal)) return false;
      if (!isValid(oldVal)) return false;

      return newVal !== oldVal;
    }

    const fields = [
      "currentEarnings",
      "lastTransferAmount",
      "lastTransferDate",
      "nextTransferDate",
      "bankAccount",
      "ip",
      "lastMonthEarnings",
      "user",
    ];

    const changedFields = fields.filter((f) => changed(f));

    if (changedFields.length > 0) {
      finalData.alert = "⚠️ Mismatch";
      try {
        new Audio(
          "https://www.allbyjohn.com/sounds/mturkscanner/lessthan15Short.mp3"
        ).play();
      } catch {}
    }
  }

  // -------------------------
  // SAVE
  // -------------------------
  await setDoc(ref, finalData);

  toast(`Synced ${data.workerId} (${finalData.alert})`);
})();
