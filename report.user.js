// ==UserScript==
// @name         🔒 MTurk Earnings Report (v5.9 - readable)
// @namespace    ab2soft.secure
// @version      5.11
// @match        https://worker.mturk.com/earnings*
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(async () => {
  'use strict';

  // -------------------------
  // Configuration / constants
  // -------------------------
  const SHEET_CSV = 'https://docs.google.com/spreadsheets/d/1Ytmr7dHSAv69N27uZcrhKaEerL8WhzMCI02vugq_C_M/export?format=csv&gid=0';

  // Firebase (same as previous builds)
  const FIREBASE_APP_JS = 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
  const FIRESTORE_JS = 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

  // Firebase config object (from earlier v5.x)
  const FIREBASE_CFG = {
    apiKey: "AIzaSyCCtBCAJvQCDj8MXb2w90qYUqRrENIIGIQ",
    authDomain: "mturk-monitordeep.firebaseapp.com",
    projectId: "mturk-monitordeep",
    storageBucket: "mturk-monitordeep.firebasestorage.app",
    messagingSenderId: "58392297487",
    appId: "1:58392297487:web:1365ad12110ffd0586637a"
  };

  // SHA-256 hex of the password "AB2EARNINGS2025"
  // We compute SHA-256 at runtime and compare to this hex string.
  const PASS_HASH_HEX = '9b724d9df97a91d297dc1c714a3987338ebb60a2a53311d2e382411a78b9e07d';

  // -------------------------
  // Small helpers
  // -------------------------
  const sha256hex = async (text) => {
    const enc = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const safeJSONParse = s => { try { return JSON.parse(s.replace(/&quot;/g, '"')); } catch { return null; } };

  // -------------------------
  // DOM extraction helpers
  // -------------------------
  function getWorkerId() {
    // Prefer the data-react-props copy widget, fall back to visible span
    const el = $$('[data-react-props]').find(e => e.getAttribute('data-react-props')?.includes('textToCopy'));
    if (el) {
      const j = safeJSONParse(el.getAttribute('data-react-props'));
      if (j?.textToCopy) return j.textToCopy.trim();
    }
    return document.querySelector('.me-bar .text-uppercase span')?.textContent.trim() || '';
  }

  function extractNextTransferInfo() {
    // The page uses a <strong> message: either direct_deposit link or amazon gift card link
    const strongTag = $$('strong').find(el => /transferred to your/i.test(el.textContent));
    let bankAccount = '';
    let nextTransferDate = '';

    if (strongTag) {
      // find either direct_deposit or amazon gift card link
      const bankLink = strongTag.querySelector("a[href*='direct_deposit']") || strongTag.querySelector("a[href*='https://www.amazon.com/gp/css/gc/balance']");
      if (bankLink) {
        if (/amazon\.com/i.test(bankLink.href)) bankAccount = 'Amazon Gift Card Balance';
        else if (/direct_deposit/i.test(bankLink.href)) bankAccount = 'Bank Account';
        else bankAccount = bankLink.textContent.trim() || 'Other Method';
      }

      // extract date like "on Nov 04, 2025 based"
      const text = strongTag.textContent.replace(/\s+/g, ' ');
      const m = text.match(/on\s+([A-Za-z]{3,}\s+\d{1,2},\s+\d{4})\s+based/i);
      if (m) nextTransferDate = m[1].trim();
    }

    return { bankAccount, nextTransferDate };
  }

  function computeLastMonthEarningsFromTransferBody(bodyDataArray) {
    // bodyData contains items with requestedDate like "09/30/25" and amountRequested numeric
    if (!Array.isArray(bodyDataArray)) return '0.00';
    const now = new Date();
    const startThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startLastMonth = new Date(startThisMonth.getFullYear(), startThisMonth.getMonth() - 1, 1);
    const endLastMonth = new Date(startThisMonth.getFullYear(), startThisMonth.getMonth(), 0);
    endLastMonth.setHours(23, 59, 59, 999);

    let total = 0;
    for (const item of bodyDataArray) {
      const ds = (item.requestedDate || '').trim();
      if (!ds) continue;
      const parts = ds.split('/');
      if (parts.length !== 3) continue;
      const mm = parseInt(parts[0], 10);
      const dd = parseInt(parts[1], 10);
      let yy = parseInt(parts[2], 10);
      if (Number.isNaN(mm) || Number.isNaN(dd) || Number.isNaN(yy)) continue;
      if (yy < 100) yy += 2000;
      const d = new Date(yy, mm - 1, dd);
      if (d >= startLastMonth && d <= endLastMonth) {
        const amt = typeof item.amountRequested === 'number' ? item.amountRequested : parseFloat(String(item.amountRequested || '0'));
        if (!Number.isNaN(amt)) total += amt;
      }
    }

    return total > 0 ? total.toFixed(2) : '0.00';
  }

  async function extractPageData() {
    const html = document.body.innerHTML.replace(/\s+/g, ' ');
    const workerId = getWorkerId();
    const userName = document.querySelector(".me-bar a[href='/account']")?.textContent.trim() || '';
    const currentEarnings = (html.match(/Current Earnings:\s*\$([\d.]+)/i) || [])[1] || '0.00';

    let lastTransferAmount = '';
    let lastTransferDate = '';
    let lastMonthEarnings = '0.00';

    try {
      const el = $$('[data-react-class]').find(e => e.getAttribute('data-react-class')?.includes('TransferHistoryTable'));
      if (el) {
        const attr = el.getAttribute('data-react-props');
        if (attr) {
          const parsed = safeJSONParse(attr);
          const body = parsed?.bodyData || [];
          if (body.length > 0) {
            const last = body[0];
            lastTransferAmount = (last.amountRequested ?? '').toString();
            lastTransferDate = last.requestedDate ?? '';
          }
          lastMonthEarnings = computeLastMonthEarningsFromTransferBody(body);
        }
      }
    } catch (e) {
      console.warn('Transfer history parse error', e);
    }

    const { bankAccount, nextTransferDate } = extractNextTransferInfo();

    let ip = 'unknown';
    try {
      const r = await fetch('https://api.ipify.org?format=json');
      const j = await r.json();
      ip = j.ip || ip;
    } catch (e) {
      // ignore
    }

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

  // -------------------------
  // load sheet mapping
  // -------------------------
  async function loadSheetMap() {
    try {
      const res = await fetch(SHEET_CSV, { cache: 'no-store' });
      const txt = await res.text();
      const rows = txt.split(/\r?\n/).filter(Boolean).map(r => r.split(','));
      const header = rows.shift().map(h => h.trim());
      const wi = header.findIndex(h => /worker.?id/i.test(h));
      const ui = header.findIndex(h => /user|name/i.test(h));
      const map = {};
      if (wi === -1 || ui === -1) {
        console.warn('Sheet missing workerid or user column', header);
        return map;
      }
      for (const r of rows) {
        const w = (r[wi] || '').replace(/^\uFEFF/, '').trim();
        const u = (r[ui] || '').trim();
        if (w && u) map[w] = u;
      }
      return map;
    } catch (e) {
      console.error('Failed to load sheet', e);
      return {};
    }
  }

  // -------------------------
  // one-time password gate (per workerId)
  // -------------------------
  async function ensurePassword(workerId) {
    const key = `verified_${workerId}`;
    const ok = await GM_getValue(key, false);
    if (ok) {
      console.log(`Password already verified for ${workerId}`);
      return;
    }

    const entered = prompt(`🔒 Enter password for WorkerID ${workerId}:`);
    if (!entered) {
      alert('❌ Password required');
      throw new Error('no password');
    }
    const h = await sha256hex(entered.trim());
    if (h !== PASS_HASH_HEX) {
      alert('❌ Incorrect password');
      throw new Error('bad password');
    }

    await GM_setValue(key, true);
    console.log(`✅ Password verified for ${workerId}`);
  }

  // -------------------------
  // UI toast + redirect helper
  // -------------------------
  function showToastAndRedirect(text = 'Redirecting to Tasks in 3 seconds…', delay = 3000, href = 'https://worker.mturk.com/tasks/') {
    try {
      const note = document.createElement('div');
      note.textContent = text;
      Object.assign(note.style, {
        position: 'fixed',
        right: '16px',
        bottom: '16px',
        background: '#111827',
        color: '#fff',
        padding: '8px 12px',
        borderRadius: '8px',
        fontFamily: 'Inter, Roboto, Arial, sans-serif',
        fontSize: '12px',
        zIndex: 999999
      });
      document.body.appendChild(note);
    } catch (e) {
      /* ignore */
    }
    setTimeout(() => {
      try { window.location.href = href; } catch { location.assign(href); }
    }, delay);
  }

  // -------------------------
  // Initialize Firebase
  // -------------------------
  const { initializeApp } = await import(FIREBASE_APP_JS);
  const { getFirestore, doc, getDoc, setDoc } = await import(FIRESTORE_JS);
  const app = initializeApp(FIREBASE_CFG);
  const db = getFirestore(app);

  // -------------------------
  // Main flow
  // -------------------------
  const data = await extractPageData();

  // If all 4 transfer fields blank => refresh once and re-run
  if (!data.lastTransferAmount && !data.lastTransferDate && !data.nextTransferDate && !data.bankAccount) {
    if (!sessionStorage.getItem('earnings_blank_refresh')) {
      sessionStorage.setItem('earnings_blank_refresh', '1');
      console.warn('All transfer fields blank — refreshing once to re-fetch data.');
      setTimeout(() => location.reload(), 1500);
      return;
    } else {
      console.log('Already refreshed once for blank transfers; continuing.');
      sessionStorage.removeItem('earnings_blank_refresh');
    }
  }

  if (!data.workerId) {
    console.warn('No workerId found — abort');
    showToastAndRedirect('No Worker ID found — redirecting to tasks', 3000);
    return;
  }

  // password guard (one-time per worker)
  await ensurePassword(data.workerId);

  // attach user from sheet
  const userMap = await loadSheetMap();
  data.user = userMap[data.workerId] || data.userName || 'Unknown';

  // Firestore doc reference
  const ref = doc(db, 'earnings_logs', data.workerId);

  // read previous
  const prevSnap = await getDoc(ref);
  let alert = '✅ OK';

  if (prevSnap.exists()) {
    const p = prevSnap.data();

    // alert lock
    if (p.alert && String(p.alert).startsWith('⚠️')) {
      console.log(`Locked by alert for ${data.workerId}; skipping update.`);
      showToastAndRedirect('Locked by alert — redirecting to tasks', 3000);
      return;
    }

    if (p.bankAccount && p.bankAccount !== data.bankAccount) alert = '⚠️ Bank Changed';
    if (p.ip && p.ip !== data.ip) alert = '⚠️ IP Changed';

    // determine changed keys
    const keys = ['currentEarnings', 'lastTransferAmount', 'lastTransferDate', 'nextTransferDate', 'bankAccount', 'ip', 'lastMonthEarnings'];
    const changedKeys = keys.filter(k => (p[k] || '') !== (data[k] || ''));
    const changed = changedKeys.length > 0;
    const changedOnlyNextTransfer = (changedKeys.length === 1 && changedKeys[0] === 'nextTransferDate');

    // if changed and not just nextTransferDate => refresh once before updating (re-verify)
    if (changed && !changedOnlyNextTransfer) {
      if (!sessionStorage.getItem('earnings_mismatch_refresh')) {
        sessionStorage.setItem('earnings_mismatch_refresh', '1');
        console.warn('Data mismatch detected — refreshing earnings page once before update.');
        setTimeout(() => location.reload(), 1500);
        return;
      } else {
        console.log('Already refreshed once for mismatch; proceeding to update.');
        sessionStorage.removeItem('earnings_mismatch_refresh');
      }
    }

    // if nothing changed and alert same => skip and redirect
    if (!changed && alert === p.alert) {
      console.log('No change; skipping write.');
      showToastAndRedirect('No change — redirecting to tasks', 3000);
      return;
    }
  }

  // if alert (bank/ip change) play sound
  if (alert.startsWith('⚠️')) {
    try { new Audio('https://www.allbyjohn.com/sounds/mturkscanner/lessthan15Short.mp3').play(); } catch { /* ignore */ }
  }

  // Write ordered fields into Firestore. Timestamp in Asia/Kolkata (human readable).
  const timestampAsiaKolkata = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });

  await setDoc(ref, {
    workerId: data.workerId,
    user: data.user,
    currentEarnings: data.currentEarnings,
    lastTransferAmount: data.lastTransferAmount,
    lastMonthEarnings: data.lastMonthEarnings,
    lastTransferDate: data.lastTransferDate,
    nextTransferDate: data.nextTransferDate,
    bankAccount: data.bankAccount,
    ip: data.ip,
    alert,
    timestamp: timestampAsiaKolkata
  });

  // cleanup any session flags used for refresh guards
  sessionStorage.removeItem('earnings_blank_refresh');
  sessionStorage.removeItem('earnings_mismatch_refresh');

  console.log(`[MTurk→Firebase] Synced ${data.workerId} (${alert}) — timestamp ${timestampAsiaKolkata}`);

  showToastAndRedirect(`Synced ${data.workerId} (${alert}) — redirecting in 3s`, 3000);

})();
