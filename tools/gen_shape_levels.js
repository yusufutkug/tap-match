"use strict";

// Tam dolu şekil paketleri yazar:
//   node tools/gen_shape_levels.js → ../levels_shapes.js (TM_SHAPE_PACKS)
// Deterministik: aynı tablolar + seed her zaman aynı paketleri üretir.
//
// Her boyut için 50 level: 4 şekil (kalp, çarpı, çerçeve, halka) döner,
// akış reçetesi 10'luk bantlarla sertleşir (soyma kadranları — bkz.
// js/generator.js peelBuild):
//   L1-10 : yılan, giriş 1, kısa ışın        → tek cepheli, en yönlendirilmiş
//   L11-20: cepheler, giriş 2               → iki koldan soyma
//   L21-30: bölge, giriş 3, bel 3           → dilim dilim, orta nefes
//   L31-40: cepheler, giriş 3, sadakat 0.7  → gevşek disiplin, uzun ışın
//   L41-50: serbest, giriş 4, bel 2         → dar bel + köşe ağır, en zor
// Etiket şeridi (meta.label) banda göre: easy easy medium hard veryhard.
//
// Hızlı deneme: TM_SIZES=6x8 node tools/gen_shape_levels.js (dosya yazmaz)

const fs = require("fs");
const path = require("path");
const { TM_SHAPES } = require("../js/shapes.js");
const { generateFullLevel } = require("../js/generator.js");
const { pairsCurve, analyzeFlow } = require("../js/flow.js");

const ALL_SIZES = ["6x8", "6x9", "7x9", "7x10", "8x10", "8x12", "8x14", "9x12", "9x15", "12x18"];
const SIZES = process.env.TM_SIZES ? process.env.TM_SIZES.split(",") : ALL_SIZES;
const DRY = !!process.env.TM_SIZES;

const SHAPES = ["kalp", "carpi", "cerceve", "halka"];

// 10'luk bantlar: soyma kadranı reçeteleri (kolay → zor)
const BANDS = [
  { label: "easy",     frontMode: "yilan",    entryN: 1, frontBias: 1.0, cornerP: 0.30, spanBias: 0.30 },
  { label: "easy",     frontMode: "cepheler", entryN: 2, frontBias: 1.0, cornerP: 0.45, spanBias: 0.40 },
  { label: "medium",   frontMode: "bolge",    entryN: 3, frontBias: 1.0, cornerP: 0.55, spanBias: 0.50, waistOpen: 3 },
  { label: "hard",     frontMode: "cepheler", entryN: 3, frontBias: 0.7, cornerP: 0.65, spanBias: 0.65, waistOpen: 3 },
  { label: "veryhard", frontMode: null,       entryN: 4,                 cornerP: 0.75, spanBias: 0.80, waistOpen: 2 },
];

function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function buildPack(sizeStr) {
  const [cols, rows] = sizeStr.split("x").map(Number);
  const levels = [];
  for (let id = 1; id <= 50; id++) {
    const band = BANDS[Math.floor((id - 1) / 10)];
    // şekil rotasyonu: bant başına ofset kayar ki her bant farklı şekille açılsın
    const shape = SHAPES[(id - 1 + Math.floor((id - 1) / 10)) % SHAPES.length];
    const mask = TM_SHAPES.maskFor(shape, rows, cols);
    if (!mask) throw new Error("maske yok: " + shape + " " + sizeStr);

    let lv = null;
    for (let retry = 0; retry < 30 && !lv; retry++) {
      lv = generateFullLevel({
        rows, cols, mask,
        seed: hashSeed("tam:" + sizeStr + ":" + id + ":" + retry),
        entryN: band.entryN,
        frontMode: band.frontMode,
        frontBias: band.frontBias,
        cornerP: band.cornerP,
        spanBias: band.spanBias,
        waistOpen: band.waistOpen,
      });
    }
    if (!lv) throw new Error("üretilemedi: " + sizeStr + " #" + id);

    // sözleşme: %100 dolu + çözülebilir + deadlock yok
    if (lv.pairs.length * 2 !== lv.maskArea) throw new Error("doluluk bozuk: " + sizeStr + " #" + id);
    if (!pairsCurve(lv.pairs, rows, cols)) throw new Error("çözülemez: " + sizeStr + " #" + id);
    if (analyzeFlow(lv.pairs, rows, cols).deadlocked.length) throw new Error("deadlock: " + sizeStr + " #" + id);

    levels.push({
      id,
      name: TM_SHAPES.DEFS[shape].name,
      rows, cols,
      pairs: lv.pairs,
      seed: lv.seed,
      mask: TM_SHAPES.encode(lv.mask),
      meta: {
        label: band.label,
        shape,
        mode: band.frontMode || "serbest",
        entryN: band.entryN,
        maskArea: lv.maskArea,
        entries: lv.entries,
        depth: lv.flow.depth,
        cornerShare: +lv.curve.cornerShare.toFixed(3),
        waistOpenAbs: lv.waistOpenAbs,
      },
    });
  }
  return { size: "tam-" + sizeStr, cols, rows, full: true, levels };
}

const packs = [];
for (const s of SIZES) {
  const t0 = Date.now();
  const pk = buildPack(s);
  const avg = (f) => pk.levels.reduce((a, l) => a + f(l), 0) / pk.levels.length;
  console.log(
    s.padEnd(7) +
    "çift " + avg((l) => l.pairs.length).toFixed(1).padEnd(7) +
    "derinlik " + avg((l) => l.meta.depth).toFixed(1).padEnd(7) +
    "köşe %" + Math.round(avg((l) => l.meta.cornerShare) * 100) + "  " +
    ((Date.now() - t0) / 1000).toFixed(1) + " sn");
  packs.push(pk);
}

if (DRY) {
  console.log("(kuru koşu — dosya yazılmadı)");
} else {
  const out =
    '"use strict";\n\n' +
    "// Üretilmiş tam dolu şekil paketleri — ELLE DÜZENLEME.\n" +
    "// tools/gen_shape_levels.js yazar; reçeteler orada.\n\n" +
    "var TM_SHAPE_PACKS = " + JSON.stringify(packs) + ";\n\n" +
    'if (typeof module !== "undefined") module.exports = { TM_SHAPE_PACKS };\n';
  fs.writeFileSync(path.join(__dirname, "..", "levels_shapes.js"), out);
  console.log("yazıldı: levels_shapes.js (" + packs.length + " paket, " +
    packs.reduce((a, p) => a + p.levels.length, 0) + " level)");
}
