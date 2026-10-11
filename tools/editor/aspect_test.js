"use strict";

// Geçici doğrulama: oyunu lab modunda açar, her skin için taş yüzü (.face)
// kutusunun en-boy oranını asset PNG oranıyla karşılaştırır + ekran görüntüsü.
//   env -u ELECTRON_RUN_AS_NODE npx electron aspect_test.js

const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..", "..");
const LEVEL = {
  name: "Aspect test", rows: 6, cols: 6, seed: 7,
  pairs: [
    [[0, 0], [0, 3]], [[2, 1], [4, 3]], [[1, 5], [3, 5]],
    [[5, 0], [5, 2]], [[2, 2], [2, 4]],
  ],
};
// beklenen yüz oranları (genişlik/yükseklik)
const EXPECT = { flat: null, a1: 260 / 259, a2: 131 / 129, a3: 261 / 257 };

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 480, height: 860 });
  const results = {};
  for (const skin of ["a3", "a2", "a1"]) {
    await win.loadFile(path.join(ROOT, "index.html"));
    await win.webContents.executeJavaScript(
      `localStorage.setItem("tm_lab_level", ${JSON.stringify(JSON.stringify(LEVEL))});
       localStorage.setItem("tm_skin", "${skin}"); true`);
    await win.loadFile(path.join(ROOT, "index.html"), { query: { lab: "1" } });
    await new Promise((r) => setTimeout(r, 600));
    results[skin] = await win.webContents.executeJavaScript(`(() => {
      const f = document.querySelector(".tile .face").getBoundingClientRect();
      const c = document.querySelector(".cell").getBoundingClientRect();
      const d = getComputedStyle(document.querySelector(".cell"), "::before");
      return {
        faceRatio: +(f.width / f.height).toFixed(4),
        cellRatio: +(c.width / c.height).toFixed(4),
        dotSize: d.backgroundSize,
      };
    })()`);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, "aspect_" + skin + ".png"), img.toPNG());
  }
  let ok = true;
  for (const [skin, r] of Object.entries(results)) {
    const exp = EXPECT[skin];
    const pass = Math.abs(r.faceRatio - exp) < 0.004;
    ok = ok && pass;
    console.log(skin + ": yüz " + r.faceRatio + " (beklenen " + exp.toFixed(4) +
      ") · hücre " + r.cellRatio + " · dot bg-size " + r.dotSize +
      (pass ? "  ✓" : "  ✗"));
  }
  app.exit(ok ? 0 : 1);
});
