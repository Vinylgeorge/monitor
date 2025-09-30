// ==UserScript==
// @name         MTurk Report
// @namespace    ab2soft.mturk.secure
// @version      2.0
// @description  Sync MTurk earnings to Firebase with change alerts; gated by password and obfuscated
// @match        https://worker.mturk.com/earnings*
// @grant        GM_addStyle
// @updateURL    https://github.com/Vinylgeorge/monitor/raw/refs/heads/main/report.user.js
// @downloadURL  https://github.com/Vinylgeorge/monitor/raw/refs/heads/main/report.user.js
// ==/UserScript==

(function () {
  'use strict';

  
  const _b64 = (s)=>s.replace(/_/g,'/').replace(/-/g,'+');
  const _dec = (s)=>{ try{ return decodeURIComponent(escape(atob(_b64(s)))); }catch(e){ return atob(_b64(s)); } };
  const _hex = (buf)=>{ let o="",v=new Uint8Array(buf); for(let i=0;i<v.length;i++) o+=v[i].toString(16).padStart(2,"0"); return o; };
  const _sha256 = async (t)=>_hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)));

  
  const PASS_HASH = "9b724d9df97a91d297dc1c714a3987338ebb60a2a53311d2e382411a78b9e07d";

  
  const gateCSS = `
  #ab2_gate{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:linear-gradient(180deg,#0f172a 0,#111827 100%);font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif}
  #ab2_card{width:min(420px,92vw);background:#0b1220;border:1px solid #1f2937;border-radius:14px;padding:22px;color:#dbeafe;box-shadow:0 10px 40px rgba(0,0,0,.45)}
  #ab2_card h2{margin:0 0 14px 0;font-weight:700}
  #ab2_card p{margin:0 0 12px 0;color:#93c5fd}
  #ab2_pw{width:100%;padding:12px 14px;border-radius:10px;border:1px solid #334155;background:#0a1222;color:#e5e7eb;outline:none}
  #ab2_pw:focus{border-color:#60a5fa;box-shadow:0 0 0 3px rgba(96,165,250,.25)}
  #ab2_btn{width:100%;margin-top:12px;background:#22c55e;border:0;color:white;padding:10px 14px;border-radius:10px;cursor:pointer}
  #ab2_btn:hover{background:#16a34a}
  #ab2_msg{margin-top:10px;font-size:12px;color:#fca5a5;min-height:16px}
  `;
  if (typeof GM_addStyle === 'function') GM_addStyle(gateCSS);
  else {
    const st = document.createElement('style'); st.textContent = gateCSS; document.head.appendChild(st);
  }

  const gate = document.createElement('div');
  gate.id = 'ab2_gate';
  gate.innerHTML = `
    <div id="ab2_card" role="dialog" aria-label="Secure Access">
      <h2>🔒 Secure Access</h2>
      <p>Enter password</p>
      <input id="ab2_pw" type="password" placeholder="•••••••••••••••" autocomplete="current-password" />
      <button id="ab2_btn">Unlock</button>
      <div id="ab2_msg"></div>
    </div>
  `;
  document.documentElement.appendChild(gate);

  const $ = (id)=>document.getElementById(id);
  const pw = $('ab2_pw'), btn = $('ab2_btn'), msg = $('ab2_msg');

  async function unlock() {
    msg.textContent = '';
    const val = (pw.value || '').trim();
    if (!val) { msg.textContent = 'Password required'; return; }
    try {
      const digest = await _sha256(val);
      if (digest === PASS_HASH) {
        // Remove gate and inject module securely
        gate.remove();
        injectModule();
      } else {
        msg.textContent = 'Password incorrect';
      }
    } catch (e) {
      msg.textContent = 'Crypto error: ' + (e && e.message ? e.message : e);
    }
  }
  btn.addEventListener('click', unlock);
  pw.addEventListener('keydown', (e)=>{ if (e.key === 'Enter') unlock(); });

  
  function injectModule() {
    const s = document.createElement('script');
    s.type = 'module';

    
    s.innerHTML = `
      const _b64=(s)=>s.replace(/_/g,'/').replace(/-/g,'+');
      const _dec=(s)=>{try{return decodeURIComponent(escape(atob(_b64(s))))}catch(e){return atob(_b64(s))}};
      
      const u1=_dec("aHR0cHM6Ly93d3cuZ3N0YXRpYy5jb20vZmlyZWJhc2Vqcy8xMC4xMi4wL2ZpcmViYXNlLWFwcC5qcw");
      const u2=_dec("aHR0cHM6Ly93d3cuZ3N0YXRpYy5jb20vZmlyZWJhc2Vqcy8xMC4xMi4wL2ZpcmViYXNlLWZpcmVzdG9yZS5qcw");
      // Firebase config (as JSON, base64)
      const cfg=JSON.parse(_dec("eyJhcGlLZXkiOiJBSXphU3lDQ3RCQ0FadlFXQ0RqOG1YZjJiOTBxWVVxUnJFTklJR0lRIiwiYXV0aERvbWFpbiI6Im10dXJrLW1vbml0b3JkZWVwLmZpcmViYXNlYXBwLmNvbSIsInByb2plY3RJZCI6Im10dXJrLW1vbml0b3JkZWVwIiwic3RvcmFnZUJ1Y2tldCI6Im10dXJrLW1vbml0b3JkZWVwLmZpcmViYXNlc3RvcmFnZS5hcHAiLCJtZXNzYWdpbmdTZW5kZXJJZCI6IjU4MzkyMjk3NDg3IiwiYXBwSWQiOiIxOjU4MzkyMjk3NDg3OndlYjoxMzY1YWQxMjExMGZmZDA1ODY2MzdhIn0="));

      
      const { initializeApp } = await import(u1);
      const { getFirestore, doc, getDoc, setDoc, serverTimestamp } = await import(u2);

      const app = initializeApp(cfg);
      const db = getFirestore(app);

      
      function extractWorkerID(){
        try{
          const nodes=document.querySelectorAll('[data-react-props*="textToCopy"]');
          for(const n of nodes){
            const pd=n.getAttribute('data-react-props');
            if(pd){
              const json=pd.replace(/&quot;/g,'"').replace(/&#39;/g,"'");
              const obj=JSON.parse(json);
              if(obj.textToCopy && /^A[0-9A-Z]+$/.test(obj.textToCopy)) return obj.textToCopy;
            }
          }
          const s=document.body.innerText.match(/A[0-9A-Z]{10,}/);
          return s?s[0]:"N/A";
        }catch{return "N/A";}
      }

      async function getIP(){
        try{
          const r=await fetch('https://api.ipify.org?format=json',{cache:'no-store'});
          const j=await r.json(); return j.ip||'0.0.0.0';
        }catch{ return '0.0.0.0'; }
      }

      function extractEarnings(){
        const html=document.body.innerHTML;
        const current=(html.match(/Current Earnings:\\s*\\$([0-9]+\\.[0-9]+)/)?.[1]||"0");
        const bank=(html.match(/bank account <a href="\\/direct_deposit">([^<]+)<\\/a>/)?.[1]?.trim()||"N/A");
        const nextTransfer=(html.match(/on ([A-Za-z]+ \\d{2}, \\d{4})/i)?.[1]||"N/A");
        // last transfer amount & date from embedded props
        // uses first item of bodyData (most recent)
        const m=html.match(/requestedDate&quot;:&quot;([0-9\\/]+).*?amountRequested&quot;:(\\d+\\.?\\d*)/);
        let lastTransferDate="N/A", lastTransferAmount="0";
        if(m){ lastTransferDate=m[1]; lastTransferAmount=m[2]; }
        return { current, bank, nextTransfer, lastTransferAmount, lastTransferDate };
      }

      
      async function runUpload(){
        const workerId = extractWorkerID();
        const ip = await getIP();
        const { current, bank, nextTransfer, lastTransferAmount, lastTransferDate } = extractEarnings();

        const ref = doc(db, "earnings_logs", workerId);
        const snap = await getDoc(ref);

        let alert="OK", shouldUpdate=true;
        if(snap.exists()){
          const old=snap.data()||{};
          if(old.bankAccount && old.bankAccount!==bank){ alert="⚠️ BANK CHANGED"; shouldUpdate=false; }
          else if(old.ip && old.ip!==ip){ alert="⚠️ IP CHANGED"; shouldUpdate=false; }
        }

        if(!shouldUpdate){
          await setDoc(ref, { alert, timestamp: serverTimestamp() }, { merge:true });
          console.warn("⚠️ ALERT: stopping updates for", workerId, alert);
          return;
        }

        const payload={
          workerId,
          currentEarnings: current,
          lastTransferAmount,
          lastTransferDate,
          nextTransferDate: nextTransfer,
          bankAccount: bank,
          ip,
          alert,
          timestamp: serverTimestamp(),
        };

        await setDoc(ref, payload, { merge:true });
        console.log("✅ Uploaded:", payload);
      }

      runUpload().catch(e=>console.error("Upload error:", e));
    `;

    document.head.appendChild(s);
  }
})();
