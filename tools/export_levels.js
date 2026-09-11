"use strict";

// Efor paketlerini dış motor formatına TEK FUNNEL olarak aktarır:
//   node tools/export_levels.js → export_levels/<n>_<e|m|h>.json (n = 1..100)
//                                 + export_levels/funnel.csv (sıralı dosya adları)
//
// Funnel sırası: boyut merdiveni alan artışıyla (6x8 → 7x10 → 8x12 → 9x14 →
// 10x15), her paketin 20 levelı kendi id sırasında (etiket şeridi paket
// içinde testere gibi iki kez e→vh tırmanır; boyut büyüdükçe efor ort.
// 12.2→21.9 yükselir — funnel'ın genel rampası buradan gelir).
//
// Dosya formatı (hücre dizisi, index 0 = SOL ALT, satır satır yukarı):
//   { "width": 6, "height": 8, "cells": [ ... ] }
//   -1  oyun dışı hücre (bizim boardlarda yok: dikdörtgen boardda her
//       hücre tap'lenebilir — maske dışı hücreler de dot'tur)
//    0  dot (boş, tap'lenebilir hücre)
//   1+  sticker id = çift kimliği (1 tabanlı; her id tam iki hücrede)
// Dosya adı: <funnelNo>_<diff harfi>; veryhard → "h" (dış şema e/m/h).
// İç temsil r=0 üst satır olduğundan dönüşüm: dışIdx = (rows-1-r)*cols + c.

const fs = require("fs");
const path = require("path");
const { readPack } = require("./pack_io.js");

const DIFF = { easy: "e", medium: "m", hard: "h", veryhard: "h" };
const LEVELS_DIR = path.join(__dirname, "..", "levels");
const OUT = path.join(__dirname, "..", "export_levels");

// alan artışına göre boyut merdiveni
const sizes = fs.readdirSync(LEVELS_DIR)
  .filter((d) => d.startsWith("efor-"))
  .map((d) => ({ d, pk: readPack(d) }))
  .sort((a, b) => a.pk.rows * a.pk.cols - b.pk.rows * b.pk.cols);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let no = 0;
const names = [];
for (const { pk } of sizes) {
  for (const lv of pk.levels) {
    no++;
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
    const name = no + "_" + DIFF[lv.diff];
    fs.writeFileSync(path.join(OUT, name + ".json"), json);
    names.push(name);
  }
}
fs.writeFileSync(path.join(OUT, "funnel.csv"), names.join(",") + "\n");
console.log("export_levels/ yazıldı: " + no + " level (funnel: " +
  sizes.map((s) => s.d.replace("efor-", "")).join(" → ") + ") + funnel.csv");
