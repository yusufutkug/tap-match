"use strict";

// Geçici smoke test: editörü gizli pencerede açar, renderer init'inin
// bitmesini bekler ve durumu yazdırır. Çalıştırma:
//   env -u ELECTRON_RUN_AS_NODE npx electron smoke_test.js

const { app, BrowserWindow } = require("electron");
const path = require("path");

// main.js IPC handler'larını kurar; app.whenReady penceresi de açılır ama
// smoke test kendi gizli penceresinden ölçer.
require("./main.js");

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1360,
    height: 880,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: false,
    },
  });
  const errors = [];
  win.webContents.on("console-message", (_e, level, msg) => {
    if (level >= 3) errors.push(msg);
  });
  await win.loadFile(path.join(__dirname, "editor.html"));

  // status "hazır" olana dek bekle (maks 60 sn)
  const t0 = Date.now();
  let status = "";
  while (Date.now() - t0 < 60000) {
    status = await win.webContents.executeJavaScript(
      'document.getElementById("status").textContent');
    if (status.includes("hazır")) break;
    await new Promise((r) => setTimeout(r, 300));
  }

  const report = await win.webContents.executeJavaScript(`(() => {
    const cards = document.querySelectorAll("#grid .card");
    const first = cards[0];
    first.click();
    const effortTexts = [...cards].slice(0, 3).map(c => c.querySelector(".effort").textContent);
    const sizes = [...document.querySelectorAll("#sizeFilter option")].map(o => o.value);
    return {
      cardCount: cards.length,
      effortTexts,
      sizes,
      infoTitle: document.querySelector("#infoPanel .title")?.textContent?.trim() || null,
      infoStats: document.querySelectorAll("#infoPanel .stats .k").length,
    };
  })()`);

  // manuel editör: yeni level aç, 2 çift + 1 kilitli (span-1) çift yerleştir
  const edReport = await win.webContents.executeJavaScript(`(async () => {
    await tmEdit.openNew();
    tmEdit.tap(0, 0); tmEdit.tap(0, 3);   // hizalı çift, açık koridor
    tmEdit.tap(2, 0); tmEdit.tap(4, 2);   // hizasız çift
    const okStatus = document.getElementById("edStatus").textContent;
    tmEdit.tap(6, 0); tmEdit.tap(6, 1);   // span-1 hizalı → kilitli olmalı
    const badStatus = document.getElementById("edStatus").textContent;
    return {
      overlay: !document.getElementById("editOverlay").hidden,
      pairs: tmEdit.pairCount(),
      okStatus, badStatus,
    };
  })()`);

  console.log("STATUS:", status);
  console.log("REPORT:", JSON.stringify(report, null, 2));
  console.log("EDITOR:", JSON.stringify(edReport, null, 2));
  console.log("RENDERER_ERRORS:", errors.length ? errors : "yok");
  const edOk = edReport.overlay && edReport.pairs === 3 &&
    edReport.okStatus.includes("✓") && edReport.badStatus.includes("✗");
  app.exit(status.includes("hazır") && report.cardCount === 700 && edOk &&
    !errors.length ? 0 : 1);
});
