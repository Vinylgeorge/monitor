// ==UserScript==
// @name        MTurk Queue → JSONBin (Live Data)
// @namespace   Violentmonkey Scripts
// @match       https://worker.mturk.com/tasks*
// @grant       GM_xmlhttpRequest
// ==/UserScript==

(function() {
  'use strict';

  const binId = "68c88afcd0ea881f407f17fd"; // your Bin ID
  const apiKey = "$2a$10$tGWSdPOsZbt7ecxcUqPwaOPrtBrw84TrZQDZtPvWN5Hpm595sHtUm"; // your API key
  const putUrl = `https://api.jsonbin.io/v3/b/${binId}`;

  // Send current queue snapshot to JSONBin
  function saveQueueToJsonBin(hits) {
    GM_xmlhttpRequest({
      method: "PUT",
      url: putUrl,
      headers: {
        "Content-Type": "application/json",
        "X-Master-Key": apiKey
      },
      data: JSON.stringify(hits),
      onload: r => console.log("✅ Queue updated:", r.responseText),
      onerror: e => console.error("❌ Error saving queue:", e)
    });
  }

  // Scrape HITs from MTurk Queue page
  function scrapeQueue() {
    const rows = document.querySelectorAll("table tbody tr");
    let hits = [];

    rows.forEach(row => {
      const cols = row.querySelectorAll("td");
      if (cols.length) {
        hits.push({
          requester: cols[0]?.innerText.trim(),
          title: cols[1]?.innerText.trim(),
          reward: cols[2]?.innerText.trim().replace("$", ""),
          timeRemainingSeconds: parseTime(cols[3]?.innerText.trim()),
          acceptedAt: new Date().toISOString()
        });
      }
    });

    if (hits.length) {
      saveQueueToJsonBin(hits);
    } else {
      console.log("ℹ️ No HITs currently in queue.");
    }
  }

  // Convert "XXm YYs" → seconds
  function parseTime(str) {
    if (!str) return null;
    const match = str.match(/(\d+)m\s*(\d+)s/);
    if (match) {
      return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
    }
    return null;
  }

  // Run immediately and refresh every 10s
  scrapeQueue();
  setInterval(scrapeQueue, 10000);

})();
