"use strict";

// Efor paketlerini dış motor formatına TEK FUNNEL YOLU olarak aktarır:
//   node tools/export_levels.js → export_levels/<n>_<e|m|h>.json + funnel.csv
//
// Funnel düzeni (toplam 1010):
//   1-4    öğretici leveller (tutorial_levels/1_t..4_t — stickers dahil
//          birebir kopyalanır; elle bakım orada yapılır)
//   5-10   giriş levelleri: küçük boyut + düşük doluluk + saf akış (knots 0,
//          düşük köşe) — öğreticiden ana funnel'a yumuşak rampa. Burada
//          deterministik üretilir (INTRO reçeteleri, sabit seed).
//   11+    SABİT BOYUT DÖNGÜSÜ — 100 decade × 10 pozisyon = 1000:
//   pos:   1    2    3     4     5     6    7     8    9     10
//   boyut: 6x8  6x8  7x10  7x10  8x12  6x8  7x10  6x8  9x14  6x8
// Zorluk boyuttan gelir; dış harf: 8x12 → m (hard), 9x14 → h (very hard),
// diğerleri → e. Testere deseni döngünün kendisidir (pos 5 ve 9 zirve,
// 6 soluklanma, 10 büyük nefes); global taban concave rampayla ÜRETİMDE
// çizilir (tools/gen_effort_levels.js holeFrac/cornerP/knots concave(d)),
// export ÜRETİM SIRASINI KORUR:
//   1. decade d, her boyutun havuzunda ÜRETİM KİMLİĞİYLE d'inci dilimi alır
//      (id sırası = üretim decade'i; gen_effort_levels reçeteleri concave
//      rampayı, doluluk rampasını ve 9x14 kalıp rotasyonunu decade'e göre
//      bastığı için dilimleme bunları birebir taşır — global efor sıralaması
//      denendi ve İKİ ŞEYİ BOZDU: doluluk rampası tersine döndü [hamle-başına
//      sweep eforu dolulukla ters korelasyonlu: 6x8'de fill %70 → ort 12.7,
//      %100 → 10.9] ve bitişik decade'lere aynı 9x14 kalıbı düşebiliyordu).
//   2. dilim içinde pozisyonlar ölçülen EFORLA dizilir — efor = tahmini
//      OYUNCU saniyesi (js/flow.js playTime, "player" profili: US oyuncu
//      medyan kazanma süreleriyle kalibre salience yükü, r² 0.91; önceki
//      sweep yükü = effortMean × çift sayısı oyuncu süresiyle r 0.92,
//      salience 0.95): 6x8'de en ucuz → pos 10
//      (büyük nefes), sonra pos 6 (zirve sonrası nefes — sticker tarafında
//      MONO/DUO renk levelı, bkz. assign_stickers.js), pos 1, pos 2, en
//      pahalı → pos 8; 7x10'da en ucuz → pos 7, sonra 3, 4.
// Decade'ler arası küçük yük dalgalanması testere hissinin parçasıdır;
// global taban üretimdeki concave rampadan gelir.
// Tamamen deterministik. Klasördeki TÜM eski numaralı dosyalar silinir
// (arşiv yok — funnel baştan kurulur); stickers alanları da gider, sonrasında
// tools/assign_stickers.js YENİDEN koşulmalı.
//
// Dosya formatı (hücre dizisi, index 0 = SOL ALT, satır satır yukarı):
//   { "width": 6, "height": 8, "cells": [ ... ] [, "stickers": [sid...] ] }
//   -1  oyun dışı hücre (bizim boardlarda yok: dikdörtgen boardda her
//       hücre tap'lenebilir — maske dışı hücreler de dot'tur)
//    0  dot (boş, tap'lenebilir hücre)
//   1+  sticker id = çift kimliği (1 tabanlı; her id tam iki hücrede)
//   stickers[i] = (i+1) kimliğinin kalıcı sticker sid'i (assign yazar)
// İç temsil r=0 üst satır olduğundan dönüşüm: dışIdx = (rows-1-r)*cols + c.

const fs = require("fs");
const path = require("path");
const { readPack } = require("./pack_io.js");
const { playTime } = require("../js/flow.js");
const { generateFullLevel, symMask } = require("../js/generator.js");

const LEVELS_DIR = path.join(__dirname, "..", "levels");
const TUT_DIR = path.join(__dirname, "..", "tutorial_levels");
const OUT = path.join(__dirname, "..", "export_levels");

// giriş levelleri (slot 5-10): boyut ve doluluk yumuşak rampayla ana
// funnel'a bağlanır (decade 1'in 6x8'i ~%68 dolu — giriş %60'tan tırmanır)
const INTRO = [
  { cols: 4, rows: 6, hole: 0.40, sym: "V" },
  { cols: 4, rows: 6, hole: 0.35, sym: "P" },
  { cols: 5, rows: 7, hole: 0.37, sym: "H" },
  { cols: 5, rows: 7, hole: 0.32, sym: "Q" },
  { cols: 6, rows: 8, hole: 0.34, sym: "V" },
  { cols: 6, rows: 8, hole: 0.30, sym: "P" },
];
function genIntro(i) {
  const rec = INTRO[i];
  // sabit tohum tabanı; üretim tutmazsa deterministik kaydırma
  for (let s = 0; s < 30; s++) {
    const seed = 9100 + i * 31 + s;
    const mask = symMask(rec.rows, rec.cols, seed ^ 0x9e3779b9, rec.sym, rec.hole);
    const lv = generateFullLevel({
      rows: rec.rows, cols: rec.cols, mask, seed,
      entryN: 2, frontMode: "bolge", cornerP: 0.35, spanBias: 0.28,
      knots: 0, waistOpen: 3,
    });
    if (lv) return { rows: rec.rows, cols: rec.cols, pairs: lv.pairs };
  }
  throw new Error("giriş levelı üretilemedi: slot " + (i + 5));
}

// onluk içi boyut döngüsü ve dış harfler
const CYCLE = ["6x8", "6x8", "7x10", "7x10", "8x12", "6x8", "7x10", "6x8", "9x14", "6x8"];
const LETTER = { "6x8": "e", "7x10": "e", "8x12": "m", "9x14": "h" };
// dilim içi pozisyon sırası: rank 0 = dilimin en ucuz levelı
const POS_RANK = {
  "6x8": { 9: 0, 5: 1, 0: 2, 1: 3, 7: 4 }, // pos10, pos6, pos1, pos2, pos8
  "7x10": { 6: 0, 2: 1, 3: 2 },            // pos7, pos3, pos4
  "8x12": { 4: 0 },
  "9x14": { 8: 0 },
};

// ── boyut havuzlarını topla (ÜRETİM/id sırasında), yüklerini ölç ──
const ladders = {}; // size → id sıralı level listesi (+ ölçülen yük)
for (const d of fs.readdirSync(LEVELS_DIR).filter((x) => x.startsWith("efor-")).sort()) {
  const pk = readPack(d);
  const size = d.replace("efor-", "");
  ladders[size] = pk.levels.map((lv) => {
    // efor = tahmini oyuncu saniyesi — js/flow.js playTime "player":
    // 11.3 + 0.0444·salience yükü (US oyuncu medyanlarıyla kalibre, r² 0.91).
    // Dilim içi pozisyon sırası bu sayıyla kurulur.
    const pt = playTime(lv.pairs, pk.rows, pk.cols, "player");
    if (!pt) throw new Error("tıkalı level: " + d + " #" + lv.id);
    return { rows: pk.rows, cols: pk.cols, pairs: lv.pairs, effort: pt.seconds };
  });
}

// döngüdeki boyut sayıları → decade sayısı havuzdan türetilir; eksik/artık
// havuz tutarsızlığı erken patlar (funnel'da delik olmaz)
const perDecade = {};
for (const s of CYCLE) perDecade[s] = (perDecade[s] || 0) + 1;
let decades = null;
for (const s of Object.keys(perDecade)) {
  if (!ladders[s]) throw new Error("havuz yok: efor-" + s);
  const dN = ladders[s].length / perDecade[s];
  if (!Number.isInteger(dN)) {
    throw new Error("havuz " + s + " decade'e bölünmüyor: " +
      ladders[s].length + " / " + perDecade[s]);
  }
  if (decades === null) decades = dN;
  else if (decades !== dN) throw new Error("boyut havuzları farklı decade sayısı veriyor");
}

// ── funnel dizisi: decade × pozisyon → üretim dilimi (dilim içi yük sırası) ──
const seq = []; // slot sırasında level
for (let d = 0; d < decades; d++) {
  const slice = {}; // size → bu decade'in dilimi, yük artan sıralı
  for (const s of Object.keys(perDecade)) {
    slice[s] = ladders[s]
      .slice(d * perDecade[s], (d + 1) * perDecade[s])
      .sort((a, b) => a.effort - b.effort);
  }
  for (let p = 0; p < 10; p++) {
    const size = CYCLE[p];
    const lv = slice[size][POS_RANK[size][p]];
    seq.push({ ...lv, size, letter: LETTER[size] });
  }
}

// ── yaz: tüm eski numaralı dosyalar gider, funnel baştan kurulur ──
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) {
  if (/^\d+_[emh]\.json$/.test(f)) fs.unlinkSync(path.join(OUT, f));
}
// okunur yazım: satır başına bir dizi satırı (ilk satır = boardun ALTI);
// stickers verilirse (öğretici kopyaları) alan korunur
function writeLevel(no, letter, cols, rows, cells, pairsN, stickers) {
  const w = String(pairsN).length + 1;
  const rowsTxt = [];
  for (let rr = 0; rr < rows; rr++) {
    const row = cells.slice(rr * cols, (rr + 1) * cols);
    rowsTxt.push("    " + row.map((v) => String(v).padStart(w)).join(","));
  }
  const json =
    "{\n" +
    '  "width": ' + cols + ",\n" +
    '  "height": ' + rows + ",\n" +
    '  "cells": [\n' + rowsTxt.join(",\n") + "\n  ]" +
    (stickers
      ? ',\n  "stickers": [\n' +
        stickers.map((s) => "    " + JSON.stringify(s)).join(",\n") + "\n  ]"
      : "") +
    "\n}\n";
  fs.writeFileSync(path.join(OUT, no + "_" + letter + ".json"), json);
}
const cellsOf = (lv) => {
  const cells = new Array(lv.rows * lv.cols).fill(0);
  lv.pairs.forEach((pair, pi) => {
    for (const [r, c] of pair) cells[(lv.rows - 1 - r) * lv.cols + c] = pi + 1;
  });
  return cells;
};

// 1-4: öğreticiler (stickers dahil birebir; kaynak tutorial_levels/)
for (let i = 1; i <= 4; i++) {
  const t = JSON.parse(fs.readFileSync(path.join(TUT_DIR, i + "_t.json"), "utf8"));
  writeLevel(i, "e", t.width, t.height, t.cells, Math.max(...t.cells), t.stickers);
}
// 5-10: giriş levelleri (stickers'ı assign_stickers basar)
const introLvls = INTRO.map((_, i) => genIntro(i));
introLvls.forEach((lv, i) => {
  writeLevel(5 + i, "e", lv.cols, lv.rows, cellsOf(lv), lv.pairs.length, null);
});
// 11+: ana döngü
seq.forEach((lv, slot) => {
  writeLevel(11 + slot, lv.letter, lv.cols, lv.rows, cellsOf(lv), lv.pairs.length, null);
});
// funnel.csv numara sırasıyla
const all = fs.readdirSync(OUT)
  .filter((f) => /^\d+_[emh]\.json$/.test(f))
  .map((f) => f.replace(".json", ""))
  .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
fs.writeFileSync(path.join(OUT, "funnel.csv"), all.join(",") + "\n");

// özet: giriş rampası + efor akışı (decade ortalamaları) + ilk/son decade
console.log("giriş (5-10): " + introLvls.map((l) =>
  l.cols + "x" + l.rows + "·" + l.pairs.length + "ç").join(" "));
const efs = seq.map((l) => l.effort);
const chunk = seq.length / decades;
console.log("efor yolu (decade ort, tahmini sn): " +
  Array.from({ length: decades }, (_, k) => {
    const part = efs.slice(k * chunk, (k + 1) * chunk);
    return (part.reduce((a, b) => a + b, 0) / part.length).toFixed(0);
  }).filter((_, k) => k % 5 === 0).join(" ") + " (5'te 1 örnek)");
console.log("decade 1 (slot 11-20): " + seq.slice(0, 10).map((l) => l.size + "·" + l.effort.toFixed(0)).join(" "));
console.log("decade " + decades + ": " +
  seq.slice(-10).map((l) => l.size + "·" + l.effort.toFixed(0)).join(" "));
console.log("export_levels/ yazıldı: " + (10 + seq.length) + " level (4 öğretici + " +
  "6 giriş + " + seq.length + " döngü) + funnel.csv — stickers için tools/assign_stickers.js koş");
