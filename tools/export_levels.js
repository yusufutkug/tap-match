"use strict";

// Efor paketlerini dış motor formatına aktarır:
//   node tools/export_levels.js → export_levels/<boyut>/<id>_<e|m|h>.json
//
// Format (hücre dizisi, index 0 = SOL ALT, satır satır yukarı):
//   { "width": 6, "height": 8, "cells": [ ... ] }
//   -1  oyun dışı hücre (bizim boardlarda yok: dikdörtgen boardda her
//       hücre tap'lenebilir — maske dışı hücreler de dot'tur)
//    0  dot (boş, tap'lenebilir hücre)
//   1+  sticker id = çift kimliği (1 tabanlı; her id tam iki hücrede)
// Dosya adı: <levelId>_<diff harfi>; veryhard → "h" (dış şema e/m/h).
// İç temsil r=0 üst satır olduğundan dönüşüm: dışIdx = (rows-1-r)*cols + c.

const fs = require("fs");
const path = require("path");
const { readPack } = require("./pack_io.js");

const DIFF = { easy: "e", medium: "m", hard: "h", veryhard: "h" };
const LEVELS_DIR = path.join(__dirname, "..", "levels");
const OUT = path.join(__dirname, "..", "export_levels");

const sizes = fs.readdirSync(LEVELS_DIR).filter((d) => d.startsWith("efor-")).sort();
fs.rmSync(OUT, { recursive: true, force: true });

let n = 0;
for (const size of sizes) {
  const pk = readPack(size);
  const dir = path.join(OUT, size);
  fs.mkdirSync(dir, { recursive: true });
  for (const lv of pk.levels) {
    const cells = new Array(pk.rows * pk.cols).fill(0);
    lv.pairs.forEach((pair, pi) => {
      for (const [r, c] of pair) cells[(pk.rows - 1 - r) * pk.cols + c] = pi + 1;
    });
    // okunur yazım: satır başına bir dizi satırı (ilk satır = boardun ALTI)
    const w = String(lv.pairs.length).length + 1; // -1 ve genişleme payı
    const rowsTxt = [];
    for (let rr = 0; rr < pk.rows; rr++) {
      const row = cells.slice(rr * pk.cols, (rr + 1) * pk.cols);
      rowsTxt.push("    " + row.map((v) => String(v).padStart(w)).join(","));
    }
    const json =
      "{\n" +
      '  "width": ' + pk.cols + ",\n" +
      '  "height": ' + pk.rows + ",\n" +
      '  "cells": [\n' + rowsTxt.join(",\n") + "\n  ]\n}\n";
    fs.writeFileSync(path.join(dir, lv.id + "_" + DIFF[lv.diff] + ".json"), json);
    n++;
  }
}
console.log("export_levels/ yazıldı: " + sizes.length + " boyut, " + n + " level");
