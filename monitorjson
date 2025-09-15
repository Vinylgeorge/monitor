// ==UserScript==
// @name        MTurk HIT → JSONBin (Append Correctly)
// @namespace   Violentmonkey Scripts
// @match       https://worker.mturk.com/tasks*
// @grant       GM_xmlhttpRequest
// ==/UserScript==

(function() {
  'use strict';

  const binId = "68c88afcd0ea881f407f17fd"; // your Bin ID
  const apiKey = "$2a$10$tGWSdPOsZbt7ecxcUqPwaOPrtBrw84TrZQDZtPvWN5Hpm595sHtUm"; // your API key
  const baseUrl = `https://api.jsonbin.io/v3/b/${binId}/latest`;

  function appendHitToJsonBin(newHit) {
    // Step 1: Fetch existing data
    GM_xmlhttpRequest({
      method: "GET",
      url: baseUrl,
      headers: {
        "X-Master-Key": apiKey
      },
      onload: res => {
        try {
          const body = JSON.parse(res.responseText);
          let hits = Array.isArray(body.record) ? body.record : [];

          // Step 2: Append new HIT
          hits.push(newHit);

          // Step 3: Save back
          GM_xmlhttpRequest({
            method: "PUT",
            url: `https://api.jsonbin.io/v3/b/${binId}`,
            headers: {
              "Content-Type": "application/json",
              "X-Master-Key": apiKey
            },
            data: JSON.stringify(hits),
            onload: r => console.log("✅ HIT appended:", r.responseText),
            onerror: e => console.error("❌ Error saving HIT:", e)
          });
        } catch (err) {
          console.error("❌ Error parsing JSONBin response:", err, res.responseText);
        }
      },
      onerror: err => console.error("❌ Error fetching bin:", err)
    });
  }

  // Example test HIT
  const exampleHit = {
    event: "hit_accepted",
    requester: "Shopping Receipts",
    reward: "0.01",
    workerId: "A27WGJXVQ1H0UB",
    assignmentId: "31QTRG6Q2UXOQYJNSRS5PPNZ893PY6",
    hitId: "372AGES0I4OHGMCYAL5RMMK99WYXRR",
    title: "Extract General Data & Items From Shopping Receipt",
    timeRemainingSeconds: 3599,
    time: new Date().toISOString()
  };

  // Test send
  appendHitToJsonBin(exampleHit);

})();
