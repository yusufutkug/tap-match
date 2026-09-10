"use strict";

// Efor botu kalibrasyon raporu — effortCurve'ü (js/flow.js) tüm paketlerde
// koşturur, level başına efor özetlerini diff etiketine göre gruplar.
// Amaç: etiket ayrışması (easy < medium < hard ≤ veryhard) botun efor
// modelinde de görünüyor mu? Görünmüyorsa EFFORT_WEIGHTS ayarlanır.
//
// Bulgu (ilk kalibrasyon): zirve (maks) DOYUYOR ve ayırmıyor; ayıran
// metrikler ort efor (eğri alanı) ve eşik-üstü adım payı (bkz. flow.js
// EFFORT_HI_THR yorumu) — tablolar bu ikisini gösterir, maks bilgi satırıdır.
//
// Çalıştırma:
//   node tools/report_effort.js                # tüm paketler (karma model)
//   node tools/report_effort.js --salience     # görünürlük modeli (boardSalience)
//   node tools/report_effort.js --sweep        # tarama modeli (boardSweep)
//   TM_SIZES=6x8,tam-6x8 node tools/report_effort.js   # seçili paketler
//   node tools/report_effort.js --levels 9x12  # tek paketin level dökümü

const fs = require("fs");
const path = require("path");
const { readPack } = require("./pack_io.js");
const { effortCurve } = require("../js/flow.js");

const LEVELS_DIR = path.join(__dirname, "..", "levels");
const DIFFS = ["easy", "medium", "hard", "veryhard"];
const MODEL = process.argv.includes("--salience") ? "salience"
  : process.argv.includes("--sweep") ? "sweep" : undefined;
const HI_LABEL = MODEL
  ? "2×level medyanı — zirve payı"
  : "≥ " + require("../js/flow.js").EFFORT_HI_THR;

// efor-hedefli paketler kalibrasyona girmez: etiketleri reçete şeridi,
// eğrileri şablona uydurulmuş — doğal ayrışma sinyalini kirletir
// (TM_SIZES=efor-6x8 ile yine hedeflenebilir)
const allSizes = fs.readdirSync(LEVELS_DIR).filter((d) =>
  !d.startsWith("efor-") && fs.existsSync(path.join(LEVELS_DIR, d, "pack.json")));
const sizes = process.env.TM_SIZES
  ? process.env.TM_SIZES.split(",").map((s) => s.trim()).filter(Boolean)
  : allSizes.sort();

function stats(xs) {
  if (!xs.length) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  return { n: xs.length, mean, sd };
}
const fmt = (s) => (s ? s.mean.toFixed(2) + "±" + s.sd.toFixed(2) : "—".padEnd(9));

// ── tek paketin level dökümü (--levels <size>) ──
const li = process.argv.indexOf("--levels");
if (li !== -1) {
  const size = process.argv[li + 1];
  const pk = readPack(size);
  console.log(size + " — level başına bot eforu" + (MODEL ? " (" + MODEL + ")" : "") + "\n");
  console.log("id   diff      çift  adım  ort    eşik+  maks   @t");
  for (const lv of pk.levels) {
    const ec = effortCurve(lv.pairs, pk.rows, pk.cols, null, MODEL);
    console.log(
      String(lv.id).padEnd(5) +
      String(lv.diff).padEnd(10) +
      String(lv.pairs.length).padEnd(6) +
      (ec
        ? String(ec.effort.length).padEnd(6) +
          ec.effortMean.toFixed(2).padEnd(7) +
          ec.effortHiShare.toFixed(2).padEnd(7) +
          ec.effortMax.toFixed(2).padEnd(7) +
          ec.effortMaxPos.toFixed(2)
        : "TIKALI"));
  }
  process.exit(0);
}

// ── paket × diff tablosu ──
const t0 = Date.now();
const METRICS = ["mean", "hi", "max"];
const pick = { mean: (ec) => ec.effortMean, hi: (ec) => ec.effortHiShare, max: (ec) => ec.effortMax };
const newBins = () => {
  const o = {};
  for (const m of METRICS) { o[m] = {}; for (const d of DIFFS) o[m][d] = []; }
  return o;
};
const global = newBins();
const rows = [];
let levelsN = 0, stuckN = 0;

for (const size of sizes) {
  const pk = readPack(size);
  const byDiff = newBins();
  for (const lv of pk.levels) {
    levelsN++;
    const ec = effortCurve(lv.pairs, pk.rows, pk.cols, null, MODEL);
    if (!ec) { stuckN++; console.error("TIKALI: " + size + " #" + lv.id); continue; }
    if (!DIFFS.includes(lv.diff)) continue; // bilinmeyen etiket (olmamalı)
    for (const m of METRICS) {
      byDiff[m][lv.diff].push(pick[m](ec));
      global[m][lv.diff].push(pick[m](ec));
    }
  }
  rows.push({ size, byDiff });
}

// monotonluk: ortalamalar easy < medium < hard ≤ veryhard (küçük tolerans)
function monotone(bins) {
  const m = DIFFS.map((d) => stats(bins[d])).map((s) => (s ? s.mean : null));
  if (m.some((x) => x === null)) return "?";
  return m[0] < m[1] && m[1] < m[2] && m[2] <= m[3] + 0.02 ? "✓" : "✗";
}

function table(title, key) {
  console.log(title + "\n");
  console.log("boyut".padEnd(11) + DIFFS.map((d) => d.padEnd(12)).join("") + "sıra");
  for (const { size, byDiff } of rows) {
    console.log(
      size.padEnd(11) +
      DIFFS.map((d) => fmt(stats(byDiff[key][d])).padEnd(12)).join("") +
      monotone(byDiff[key]));
  }
  console.log(
    "TÜMÜ".padEnd(11) +
    DIFFS.map((d) => fmt(stats(global[key][d])).padEnd(12)).join("") +
    monotone(global[key]) + "\n");
}

if (MODEL) {
  console.log("MODEL: " + (MODEL === "sweep"
    ? "sweep (tarama — ilk match'e kadar süpürülen search point)"
    : "salience (görünürlük — search/match point oranı)") + "\n");
}
table("ORT EFOR (eğri alanı) × diff — hücreler ort±sd; zorluk sinyali", "mean");
table("EŞİK-ÜSTÜ ADIM PAYI (efor " + HI_LABEL + ") × diff — yükün taşınma süresi", "hi");
console.log(
  "maks efor (bilgi; doyar, ayırmaz): " +
  DIFFS.map((d) => d + " " + fmt(stats(global.max[d]))).join(" · "));

console.log(
  "\n" + levelsN + " level, " + sizes.length + " paket, " +
  ((Date.now() - t0) / 1000).toFixed(1) + " sn" +
  (stuckN ? " — " + stuckN + " TIKALI level!" : ""));
