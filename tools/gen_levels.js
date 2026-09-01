"use strict";

// 100 levellik FUNNEL paketini yazar: node tools/gen_levels.js → ../levels_gen.js
// Deterministik: aynı tablolar + seed her zaman aynı paketi üretir.
//
// AG tarzı testere-dişi rampa: 10 levellik döngü × 10 dekat.
//   slot:   1     2     3      4      5     6     7     8      9         10
//   etiket: easy  easy  medium medium hard  easy  easy  medium veryhard  easy
// Zirveden (hard / very hard) hemen sonra easy rahatlama gelir; aynı etiket
// dekat ilerledikçe parametre rampasıyla (t = (dekat-1)/9) sertleşir —
// zorluk hem etiketle hem global indexle korele.

const fs = require("fs");
const path = require("path");
const { generateLevel } = require("../js/generator.js");

const LABELS = ["easy", "easy", "medium", "medium", "hard",
                "easy", "easy", "medium", "veryhard", "easy"];

// Boyutlar kolon×satır ("6x8" = 6 sütun, 8 satır).
const SIZES_D1 = ["6x8", "6x8", "7x10", "7x10", "8x12", "6x8", "6x8", "7x10", "9x12", "6x8"];
const SIZES_D2 = ["6x9", "6x9", "8x10", "8x10", "9x12", "6x9", "6x9", "8x10", "8x14", "6x9"];
const SIZES_D3 = ["7x9", "7x9", "8x10", "8x10", "9x12", "6x8", "6x9", "8x10", "8x14", "6x8"];

const NAMES = { easy: "Kolay", medium: "Orta", hard: "Zor", veryhard: "Çok Zor" };

function sizeOf(idx) { // idx: 1..100
  const decade = Math.ceil(idx / 10);
  const slot = (idx - 1) % 10;
  if (idx === 49 || idx === 99) return "12x18"; // dev zirveler (slot-9, very hard)
  let s = (decade === 1 ? SIZES_D1 : decade === 2 ? SIZES_D2 : SIZES_D3)[slot];
  // İndexle zorlaşmanın boyut ayağı: son dekatlarda very hard büyür.
  if (slot === 8 && decade >= 7) s = "9x15";
  return s;
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// Etiket bandı + global rampa → generateLevel parametreleri.
function paramsOf(label, idx, rows, cols) {
  const decade = Math.ceil(idx / 10);
  const t = (decade - 1) / 9;
  const area = rows * cols;
  const giant = area >= 200; // 12×18

  if (label === "easy") {
    return {
      entryN: clamp(Math.round(area / 18), 2, 6),
      lockedN: decade >= 6 ? 1 : 0,
      depthMin: 3, depthMax: 3 + (decade >= 4 ? 1 : 0),
      cornerP: 0.40 + 0.20 * t,
      dipMax: 0.65,
    };
  }
  if (label === "medium") {
    return {
      entryN: clamp(Math.round(area / 22), 2, 6),
      lockedN: 1 + (decade >= 5 ? 1 : 0),
      depthMin: 4, depthMax: 5 + (decade >= 6 ? 1 : 0),
      cornerP: 0.60 + 0.15 * t,
      dipMax: 0.5,
    };
  }
  if (label === "hard") {
    return {
      entryN: clamp(Math.round(area / 26), 3, 6),
      lockedN: clamp(2 + Math.floor(decade / 3), 2, Math.floor(area / 24)),
      depthMin: 5, depthMax: 7,
      cornerP: 0.75,
      dipMax: 0.5,
      waistPosTarget: 0.40,
      waistOpenMax: decade >= 5 ? 3 : 4,
    };
  }
  // veryhard
  return {
    entryN: clamp(Math.round(area / 24), 4, 8),
    lockedN: giant ? 8 : clamp(4 + Math.floor(decade / 2), 4, Math.floor(area / 26)),
    gateN: giant ? 2 : 1,
    depthMin: decade === 1 ? 5 : 6, depthMax: 8,
    cornerP: 0.80,
    dipMax: 0.45,
    waistPosTarget: 0.42 + 0.03 * t,
    waistOpenMax: decade >= 6 && !giant ? 2 : 3,
  };
}

// Üretim garantisi: sıkışan reçete kademeli gevşetilir (deneme tavanı ↑,
// bel kısıtı ↑, kilitli ↓, derinlik ↓) — funnel'da delik kalamaz.
function generateWithRelax(recipe) {
  const steps = [
    (o) => o,
    (o) => ({ ...o, maxAttempts: 3000 }),
    (o) => ({ ...o, maxAttempts: 3000, waistOpenMax: o.waistOpenMax ? o.waistOpenMax + 1 : undefined }),
    (o) => ({ ...o, maxAttempts: 3000, waistOpenMax: undefined, lockedN: Math.max(0, o.lockedN - 1) }),
    (o) => ({ ...o, maxAttempts: 3000, waistOpenMax: undefined, waistPosTarget: undefined, lockedN: Math.max(0, o.lockedN - 2), depthMin: Math.max(3, o.depthMin - 1) }),
  ];
  for (let i = 0; i < steps.length; i++) {
    const lv = generateLevel(steps[i](recipe));
    if (lv) return { lv, relaxed: i };
  }
  return null;
}

// Karşılaştırılabilir zorluk skoru (rapor + korelasyon kontrolü için):
// çift sayısı (süre), derinlik (zincir uzunluğu), efor zirvesi (arama),
// köşe payı (bilişsel yük); belde nefes alanı arttıkça kolaylaşır.
function scoreOf(lv) {
  return lv.pairs.length * 0.25 +
    lv.flow.depth * 0.8 +
    lv.curve.effortPeak * 0.04 +
    lv.curve.cornerShare * 3 -
    lv.waistOpenAbs * 0.5;
}

function buildLevel(idx, seedOffset) {
  const label = LABELS[(idx - 1) % 10];
  const [cols, rows] = sizeOf(idx).split("x").map(Number);
  const recipe = {
    rows, cols,
    ...paramsOf(label, idx, rows, cols),
    seed: 20000 + idx + (seedOffset || 0) * 1000,
    maxAttempts: 1200,
  };
  const res = generateWithRelax(recipe);
  if (!res) return null;
  const { lv, relaxed } = res;
  const score = scoreOf(lv);
  return {
    id: idx, name: NAMES[label], rows, cols,
    pairs: lv.pairs, seed: lv.seed,
    meta: {
      label,
      score: +score.toFixed(2),
      depth: lv.flow.depth,
      dip: +lv.curve.dip.toFixed(3),
      fill: +lv.fill.toFixed(3),
      cornerShare: +lv.curve.cornerShare.toFixed(3),
      waistPos: +lv.curve.waistPos.toFixed(3),
      waistOpenAbs: lv.waistOpenAbs,
      fused: lv.fused,
      inertEntries: lv.inertEntries,
      effortPeak: +lv.curve.effortPeak.toFixed(1),
      relaxed,
    },
  };
}

const levels = [];
for (let idx = 1; idx <= 100; idx++) {
  const level = buildLevel(idx, 0);
  if (!level) {
    console.error("ÜRETİLEMEDİ: level " + idx);
    process.exit(1);
  }
  levels.push(level);
}

// ── Onarım geçidi ──
// Skor kısmen emergent (derinlik zincir kaskadından gelir, seed şansına
// bağlı saçılır); parametre bantları tek başına dekat içi sıralamayı ve
// etiket trendini garanti etmez. Deterministik onarım: sıralamayı bozan
// hard / very hard leveli farklı seedlerle yeniden üret, skor tabanını
// geçen ilk adayı al (geçen yoksa en yükseği).
function rerollAbove(idx, floor) {
  const cur = levels[idx - 1];
  if (cur.meta.score > floor) return;
  let best = cur;
  for (let k = 1; k <= 15; k++) {
    const cand = buildLevel(idx, k);
    if (!cand) continue;
    if (cand.meta.score > best.meta.score) best = cand;
    if (cand.meta.score > floor) break;
  }
  if (best !== cur) levels[idx - 1] = best;
  if (best.meta.score <= floor) {
    console.log("  (uyarı: level " + idx + " skor tabanı aşılamadı: " +
      best.meta.score.toFixed(1) + " ≤ " + floor.toFixed(1) + ")");
  }
}

let prevHard = -Infinity, prevVh = -Infinity;
for (let d = 1; d <= 10; d++) {
  const slice = () => levels.slice((d - 1) * 10, d * 10);
  const meanOf = (lab) => {
    const xs = slice().filter((l) => l.meta.label === lab).map((l) => l.meta.score);
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  };
  const hardIdx = (d - 1) * 10 + 5, vhIdx = (d - 1) * 10 + 9;
  // dekat içi sıralama + hafif tolere edilmiş dekatlar arası yükseliş
  rerollAbove(hardIdx, Math.max(meanOf("medium") + 0.5, prevHard - 1));
  rerollAbove(vhIdx, Math.max(levels[hardIdx - 1].meta.score + 0.5, prevVh - 1));
  prevHard = Math.max(prevHard, levels[hardIdx - 1].meta.score);
  prevVh = Math.max(prevVh, levels[vhIdx - 1].meta.score);
}

console.log("id   etiket   boyut  çift  depth  dip    waist@  belAçk  effPk  köşe%  skor   gevş");
for (const l of levels) {
  console.log(
    String(l.id).padEnd(5) +
    l.meta.label.padEnd(9) +
    (l.cols + "×" + l.rows).padEnd(7) +
    String(l.pairs.length).padEnd(6) +
    String(l.meta.depth).padEnd(7) +
    l.meta.dip.toFixed(2).padEnd(7) +
    l.meta.waistPos.toFixed(2).padEnd(8) +
    String(l.meta.waistOpenAbs).padEnd(8) +
    l.meta.effortPeak.toFixed(0).padEnd(7) +
    ((l.meta.cornerShare * 100).toFixed(0) + "%").padEnd(7) +
    l.meta.score.toFixed(1).padEnd(7) +
    (l.meta.relaxed ? "×" + l.meta.relaxed : "")
  );
}

// ── Korelasyon raporu ──
// (a) her dekatta etiket sıralaması: easy < medium < hard ≤ veryhard
// (b) aynı etiketin dekatlar boyunca yükselen trendi
const ORDER = ["easy", "medium", "hard", "veryhard"];
const byLabel = {};
console.log("\ndekat  easy   medium  hard   vhard  sıralama");
let orderFails = 0;
for (let d = 1; d <= 10; d++) {
  const slice = levels.slice((d - 1) * 10, d * 10);
  const mean = {};
  for (const lab of ORDER) {
    const xs = slice.filter((l) => l.meta.label === lab).map((l) => l.meta.score);
    mean[lab] = xs.reduce((a, b) => a + b, 0) / xs.length;
    (byLabel[lab] = byLabel[lab] || []).push(mean[lab]);
  }
  const ok = mean.easy < mean.medium && mean.medium < mean.hard && mean.hard <= mean.veryhard + 1e-9;
  if (!ok) orderFails++;
  console.log(
    String(d).padEnd(7) +
    mean.easy.toFixed(1).padEnd(7) +
    mean.medium.toFixed(1).padEnd(8) +
    mean.hard.toFixed(1).padEnd(7) +
    mean.veryhard.toFixed(1).padEnd(7) +
    (ok ? "ok" : "SAPMA")
  );
}
console.log("\netiket trendi (dekat 1 → 10 ortalama skor):");
for (const lab of ORDER) {
  const xs = byLabel[lab];
  const first = (xs[0] + xs[1]) / 2, last = (xs[8] + xs[9]) / 2;
  console.log(
    "  " + lab.padEnd(9) + xs.map((x) => x.toFixed(0)).join(" ") +
    (last > first ? "   yükseliyor ✓" : "   TREND DÜZ/TERS")
  );
}
if (orderFails) console.log("\nUYARI: " + orderFails + " dekatta etiket sıralaması sapıyor");

const out =
  '"use strict";\n\n' +
  "// ÜRETİLMİŞ paket — elle düzenleme; kaynak: tools/gen_levels.js\n" +
  "// 100 levellik funnel: E-E-M-M-H-E-E-M-VH-E döngüsü × 10 dekat, rampa.\n\n" +
  "var TM_GEN_LEVELS = " + JSON.stringify(levels) + ";\n\n" +
  'if (typeof module !== "undefined") module.exports = { TM_GEN_LEVELS };\n';

fs.writeFileSync(path.join(__dirname, "..", "levels_gen.js"), out);
console.log("\nlevels_gen.js yazıldı (" + levels.length + " level)");
