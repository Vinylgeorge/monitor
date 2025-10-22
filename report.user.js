// ==UserScript==
// @name         🔒 MTurk Earnings Report
// @namespace    ab2soft.secure
// @version      5.9
// @match        https://worker.mturk.com/earnings*
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(async () => {
  'use strict';

  // === helpers ===
  const _b64d = s => atob(s);
  const _u8 = s => new TextEncoder().encode(s);
  const _hex = a => Array.from(new Uint8Array(a)).map(b => b.toString(16).padStart(2,'0')).join('');
  const _sha256 = async s => _hex(await crypto.subtle.digest('SHA-256', _u8(s)));

  const PASS_HASH = _b64d("OWI3MjRkOWRmOTdhOTFkMjk3ZGMxYzcxNGEzOTg3MzM4ZWJiNjBhMmE1MzMxMWQyZTM4MjQxMWE3OGI5ZTA3ZA==");

  const FIREBASE_APP_URL = _b64d("aHR0cHM6Ly93d3cuZ3N0YXRpYy5jb20vZmlyZWJhc2Vqcy8xMC4xMi4wL2ZpcmViYXNlLWFwcC5qcw==");
  const FIRESTORE_URL = _b64d("aHR0cHM6Ly93d3cuZ3N0YXRpYy5jb20vZmlyZWJhc2Vqcy8xMC4xMi4wL2ZpcmViYXNlLWZpcmVzdG9yZS5qcw==");
  const SHEET_CSV = _b64d("aHR0cHM6Ly9kb2NzLmdvb2dsZS5jb20vc3ByZWFkc2hlZXRzL2QvMVl0bXI3ZEhTQXY2OU4yN3VaY3JoS2FFZXJMOFdoek1DSTAydnVncV9DX00vZXhwb3J0P2Zvcm1hdD1jc3YmZ2lkPTA=");

  const FIREBASE_CFG = JSON.parse(_b64d(
    "eyJwcm9qZWN0SWQiOiJtdHVyay1tb25pdG9yZGVlcCIsImFwaUtleSI6IkFJemFTeUNDdEJDQUp2UUNEajhNWGIydzkwcVlVcVJyRU5JSUdJUSIsImF1dGhEb21haW4iOiJtdHVyay1tb25pdG9yZGVlYy5maXJlYmFzZWFwcC5jb20iLCJzdG9yYWdlQnVja2V0IjoibXR1cmstbW9uaXRvcmRlZXAuZmlyZWJhc2VzdG9yYWdlLmFwcCIsIm1lc3NhZ2luZ1NlbmRlcklkIjoiNTgzOTIyOTc0ODciLCJhcHBJZCI6IjE6NTgzOTIyOTc0ODc6d2ViOjEzNjVhZDEyMTEwZmZkMDU4NjYzN2EifQ=="
  ));

  const { initializeApp } = await import(FIREBASE_APP_URL);
  const { getFirestore, doc, getDoc, setDoc, serverTimestamp } = await import(FIRESTORE_URL);
  const app = initializeApp(FIREBASE_CFG);
  const db = getFirestore(app);

  // === worker id ===
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

  // === next transfer info ===
  function extractNextTransferInfo() {
    const strongTag = Array.from(document.querySelectorAll("strong"))
      .find(el => /transferred to your/i.test(el.textContent));
    let bankAccount = "", nextTransferDate = "";

    if (strongTag) {
      const bankLink =
        strongTag.querySelector("a[href*='direct_deposit']") ||
        strongTag.querySelector("a[href*='https://www.amazon.com/gp/css/gc/balance']");

      if (bankLink) {
        const txt = bankLink.textContent.trim();
        if (/amazon\.com/i.test(bankLink.href)) bankAccount = "Amazon Gift Card Balance";
        else if (/direct_deposit/i.test(bankLink.href)) bankAccount = "Bank Account";
        else bankAccount = txt || "Other Method";
      }

      const text = strongTag.textContent.replace(/\s+/g, " ");
      const m = text.match(/on\s+([A-Za-z]{3,}\s+\d{1,2},\s+\d{4})\s+based/i);
      if (m) nextTransferDate = m[1].trim();
    }

    return { bankAccount, nextTransferDate };
  }

  // === compute last month ===
  function computeLastMonthEarnings(transfers) {
    const now = new Date();
    const startThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startLastMonth = new Date(startThisMonth.getFullYear(), startThisMonth.getMonth() - 1, 1);
    const endLastMonth = new Date(startThisMonth.getFullYear(), startThisMonth.getMonth(), 0);
    let total = 0;

    for (const t of (transfers || [])) {
      const ds = (t.requestedDate || "").trim();
      if (!ds) continue;
      const [mm, dd, yy] = ds.split("/");
      if (!mm || !dd || !yy) continue;
      const y = (parseInt(yy) < 100 ? 2000 + parseInt(yy) : parseInt(yy));
      const d = new Date(y, parseInt(mm) - 1, parseInt(dd));
      if (d >= startLastMonth && d <= endLastMonth) total += parseFloat(t.amountRequested || 0);
    }

    return total > 0 ? total.toFixed(2) : "0.00";
  }

  // === main data extract ===
  async function extractData() {
    const html = document.body.innerHTML.replace(/\s+/g, " ");
    const workerId = getWorkerId();
    const userName = document.querySelector(".me-bar a[href='/account']")?.textContent.trim() || "";
    const currentEarnings = (html.match(/Current Earnings:\s*\$([\d.]+)/i) || [])[1] || "0.00";

    let lastTransferAmount = "", lastTransferDate = "", lastMonthEarnings = "0.00";
    try {
      const attr = document.querySelector('[data-react-class*="TransferHistoryTable"]')?.getAttribute("data-react-props");
      if (attr) {
        const parsed = JSON.parse(attr.replace(/&quot;/g,'"'));
        const body = parsed.bodyData || [];
        const last = body[0];
        if (last) {
          lastTransferAmount = last.amountRequested?.toString() || "";
          lastTransferDate = last.requestedDate || "";
        }
        lastMonthEarnings = computeLastMonthEarnings(body);
      }
    } catch {}

    const { bankAccount, nextTransferDate } = extractNextTransferInfo();

    let ip = "unknown";
    try { ip = (await fetch("https://api.ipify.org?format=json").then(r=>r.json())).ip; } catch {}

    return { workerId, userName, currentEarnings, lastTransferAmount, lastTransferDate, nextTransferDate, bankAccount, ip, lastMonthEarnings };
  }

  // === sheet map ===
  async function loadSheet() {
    const res = await fetch(SHEET_CSV, { cache: "no-store" });
    const text = await res.text();
    const lines = text.split(/\r?\n/).filter(Boolean).map(r=>r.split(","));
    const header = lines.shift().map(h=>h.trim());
    const wi = header.findIndex(h=>/worker.?id/i.test(h));
    const ui = header.findIndex(h=>/user|name/i.test(h));
    const map = {};
    for (const r of lines) {
      const w = (r[wi]||"").trim(); const u = (r[ui]||"").trim();
      if (w && u) map[w]=u;
    }
    return map;
  }

  // === password per worker ===
  async function ensurePassword(workerId) {
    const key = `verified_${workerId}`;
    const ok = await GM_getValue(key, false);
    if (ok) return;
    const entered = prompt(`🔒 Enter password for WorkerID ${workerId}:`);
    if (!entered) throw new Error("Password required");
    const h = await _sha256(entered.trim());
    if (h !== PASS_HASH) { alert("❌ Incorrect password"); throw new Error("bad password"); }
    await GM_setValue(key, true);
  }

  // === toast + redirect ===
  function showToastAndRedirect(text='Redirecting to Tasks…', delay=3000) {
    const note = document.createElement('div');
    note.textContent = text;
    Object.assign(note.style,{position:'fixed',right:'16px',bottom:'16px',background:'#111827',color:'#fff',
      padding:'8px 12px',borderRadius:'8px',fontSize:'12px',fontFamily:'Inter,Roboto,sans-serif',zIndex:999999});
    document.body.appendChild(note);
    setTimeout(()=>location.assign('https://worker.mturk.com/tasks/'),delay);
  }

  // === main ===
  const data = await extractData();

  // if all transfer fields blank → refresh once
  if (!data.lastTransferAmount && !data.lastTransferDate && !data.nextTransferDate && !data.bankAccount) {
    if (!sessionStorage.getItem("earnings_blank_refresh")) {
      sessionStorage.setItem("earnings_blank_refresh","1");
      console.warn("⚠️ All blank — refreshing page once to fetch data.");
      setTimeout(()=>location.reload(),1500);
      return;
    } else {
      sessionStorage.removeItem("earnings_blank_refresh");
    }
  }

  if (!data.workerId) return;

  await ensurePassword(data.workerId);
  const userMap = await loadSheet();
  data.user = userMap[data.workerId] || data.userName || "Unknown";

  const ref = doc(db, "earnings_logs", data.workerId);
  const prev = await getDoc(ref);
  let alert = "✅ OK";

  if (prev.exists()) {
    const p = prev.data();
    if (p.alert && String(p.alert).startsWith("⚠️")) return;

    if (p.bankAccount && p.bankAccount !== data.bankAccount) alert = "⚠️ Bank Changed";
    if (p.ip && p.ip !== data.ip) alert = "⚠️ IP Changed";

    const keys = ["currentEarnings","lastTransferAmount","lastTransferDate","nextTransferDate","bankAccount","ip","lastMonthEarnings"];
    const changedKeys = keys.filter(k => (p[k]||"") !== (data[k]||""));
    const changed = changedKeys.length > 0;
    const onlyNextTransferChanged = (changedKeys.length === 1 && changedKeys[0] === "nextTransferDate");

    if (changed && !onlyNextTransferChanged) {
      if (!sessionStorage.getItem("earnings_mismatch_refresh")) {
        sessionStorage.setItem("earnings_mismatch_refresh","1");
        console.warn("🔁 Data mismatch — refreshing once before update.");
        setTimeout(()=>location.reload(),1500);
        return;
      } else {
        sessionStorage.removeItem("earnings_mismatch_refresh");
      }
    }

    if (!changed && alert === p.alert) {
      showToastAndRedirect('No change — redirecting to Tasks…');
      return;
    }
  }

  if (alert.startsWith("⚠️")) {
    try { new Audio("https://www.allbyjohn.com/sounds/mturkscanner/lessthan15Short.mp3").play(); } catch {}
  }

  await setDoc(ref, { ...data, alert, timestamp: serverTimestamp() });
  sessionStorage.removeItem("earnings_blank_refresh");
  sessionStorage.removeItem("earnings_mismatch_refresh");
  showToastAndRedirect(`Synced ${data.workerId} (${alert}) — redirecting…`);
})();
