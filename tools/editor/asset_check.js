"use strict";

// Geçici analiz: assets/*.png dosyalarının canvas boyutu ve opak (alpha>8)
// bounding box'ı — taş görselinin gerçek oranını ölçer.
//   env -u ELECTRON_RUN_AS_NODE npx electron asset_check.js

const { app, BrowserWindow } = require("electron");
const path = require("path");

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { webSecurity: false }, // file:// görselden pixel okuma
  });
  await win.loadURL("about:blank");
  const root = path.join(__dirname, "..", "..");
  const files = ["new_tiles.png", "tile_asset_1.png", "tile_asset_2.png",
    "dot.png", "dot2.png", "dot3.png", "dot4.png"];
  const out = await win.webContents.executeJavaScript(`(async () => {
    const files = ${JSON.stringify(files)};
    const rows = [];
    for (const f of files) {
      const img = new Image();
      img.src = "file://${root.replace(/ /g, "%20")}/assets/" + f;
      await img.decode();
      const cv = document.createElement("canvas");
      cv.width = img.width; cv.height = img.height;
      const g = cv.getContext("2d");
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, cv.width, cv.height).data;
      let x0 = cv.width, y0 = cv.height, x1 = -1, y1 = -1;
      for (let y = 0; y < cv.height; y++) {
        for (let x = 0; x < cv.width; x++) {
          if (d[(y * cv.width + x) * 4 + 3] > 8) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      rows.push(f + ": canvas " + img.width + "x" + img.height +
        " (oran " + (img.width / img.height).toFixed(4) + ")" +
        " · opak " + bw + "x" + bh + " (oran " + (bw / bh).toFixed(4) + ")" +
        " · kenar boşlukları sol " + x0 + " sağ " + (img.width - 1 - x1) +
        " üst " + y0 + " alt " + (img.height - 1 - y1));
    }
    return rows;
  })()`);
  console.log(out.join("\n"));
  app.exit(0);
});
