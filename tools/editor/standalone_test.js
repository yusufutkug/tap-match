"use strict";

// Geçici test: level_editor.html'i (tek dosya, bağımsız) gizli pencerede
// açar, çift yerleştirme + doğrulama + export JSON'unu kontrol eder.
//   env -u ELECTRON_RUN_AS_NODE npx electron standalone_test.js

const { app, BrowserWindow } = require("electron");
const path = require("path");

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1200, height: 800 });
  const errors = [];
  win.webContents.on("console-message", (_e, level, msg) => {
    if (level >= 3) errors.push(msg);
  });
  await win.loadFile(path.join(__dirname, "..", "..", "level_editor.html"));

  const report = await win.webContents.executeJavaScript(`(() => {
    // top-level fonksiyon bildirimleri window'a düşer
    click([0, 0]); click([0, 3]);   // hizalı çift, açık koridor → çözülebilir
    click([2, 0]); click([4, 2]);   // hizasız çift
    const okStatus = document.getElementById("status").textContent;
    const okClass = document.getElementById("status").className;
    click([6, 0]); click([6, 1]);   // span-1 hizalı → kilitli
    const badStatus = document.getElementById("status").textContent;
    // export JSON'unu üretimle aynı yoldan kur (indirme yerine string döndür)
    const cells = new Array(st.w * st.h).fill(0);
    st.pairs.forEach((pair, pi) => {
      for (const [r, c] of pair) cells[(st.h - 1 - r) * st.w + c] = pi + 1;
    });
    return {
      pairs: st.pairs.length,
      okStatus, okClass, badStatus,
      badCount: st.bad.size,
      cellSum: cells.filter((v) => v > 0).length,
      undoWorks: (undo(), st.pairs.length === 2),
      redoWorks: (redo(), st.pairs.length === 3),
    };
  })()`);

  console.log("REPORT:", JSON.stringify(report, null, 2));
  console.log("RENDERER_ERRORS:", errors.length ? errors : "yok");
  const ok = report.pairs === 3 && report.okClass === "ok" &&
    report.okStatus.includes("✓") && report.badStatus.includes("✗") &&
    report.badCount === 1 && report.cellSum === 6 &&
    report.undoWorks && report.redoWorks && !errors.length;
  app.exit(ok ? 0 : 1);
});
