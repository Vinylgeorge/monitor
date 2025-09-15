// ==UserScript==
// @name        MTurk Queue → JSONBin (Live API Data)
// @namespace   Violentmonkey Scripts
// @match       https://worker.mturk.com/tasks*
// @grant       GM_xmlhttpRequest
// ==/UserScript==

(function() {
  'use strict';

  const binId = "68c88afcd0ea881f407f17fd"; // your Bin ID
  const apiKey = "$2a$10$tGWSdPOsZbt7ecxcUqPwaOPrtBrw84TrZQDZtPvWN5Hpm595sHtUm"; // your API key
  const putUrl = `https://api.jsonbin.io/v3/b/${binId}`;

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

  function fetchQueue() {
    GM_xmlhttpRequest({
      method: "GET",
      url: "https://worker.mturk.com/api/tasks?limit=100",
      headers: {
        "Accept": "application/json"
      },
      onload: res => {
        try {
          const body = JSON.parse(res.responseText);
          const tasks = body.tasks || [];

          const hits = tasks.map(t => ({
            requester: t.requester?.name || "Unknown",
            title: t.title || "N/A",
            reward: t.reward?.amount_in_dollars || "0.00",
            workerId: t.assignment_id || "",   // not alw_
