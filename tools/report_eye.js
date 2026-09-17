"use strict";

// Göz botu kalibrasyon raporu — efor paketlerinde akış kalitesi ölçümü:
//   node tools/report_eye.js
//
// Soru: şablonun VADİLERİNDE (akış anları, g(t) ≤ 0.5) hamleler gözle
// "anında görülür" mü? Göz botu eforu = matchlenebilir bir çifti görene dek
// incelenen taş sayısı; akış koparsa (hiç çift görünmüyor) sweep fallback
// devreye girer ve efor sıçrar. Vadi/tepe ayrı raporlanır — tepelerde
// yüksek göz eforu SORUN DEĞİL (düğüm anı), vadilerde sorun.
//
// Çıktı üretim ayarına girdi olur: hızlı-görüş eşiği (FAST) ve vadi
// fazlalık teriminin ağırlığı bu dağılımdan seçilir.

const fs = require("fs");
const path = require("path");
const { readPack } = require("./pack_io.js");
const { effortCurve, CURVE_TEMPLATES, templateAt } = require("../js/flow.js");

const FAST = 3; // "anında görüş" eşiği (incelenen taş)
const LEVELS_DIR = path.join(__dirname, "..", "levels");
const sizes = fs.readdirSync(LEVELS_DIR).filter((d) => d.startsWith("efor-")).sort();

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const q = (xs, p) => {
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

console.log("boyut    vadi ort  vadi p90  vadi hızlı≤" + FAST + "  tepe ort  tepe hızlı≤" + FAST);
const allV = [], allP = [];
for (const size of sizes) {
  const pk = readPack(size);
  const v = [], p = [];
  for (const lv of pk.levels) {
    const tpl = CURVE_TEMPLATES[lv.id <= 10 ? "bel" : "dalga"];
    const ec = effortCurve(lv.pairs, pk.rows, pk.cols, null, "eye");
    const L = ec.effort.length;
    ec.effort.forEach((e, i) => {
      (templateAt(tpl, L > 1 ? i / (L - 1) : 0) <= 0.5 ? v : p).push(e);
    });
  }
  allV.push(...v); allP.push(...p);
  const fast = (xs) => (100 * xs.filter((x) => x <= FAST).length / xs.length).toFixed(0) + "%";
  console.log(
    size.replace("efor-", "").padEnd(9) +
    mean(v).toFixed(1).padEnd(10) + String(q(v, 0.9)).padEnd(10) +
    fast(v).padEnd(13) + mean(p).toFixed(1).padEnd(10) + fast(p));
}
const fastShare = (xs, thr) => (100 * xs.filter((x) => x <= thr).length / xs.length).toFixed(0);
console.log("\nTÜMÜ: vadi ort " + mean(allV).toFixed(1) + " · tepe ort " + mean(allP).toFixed(1));
console.log("vadi hızlı-pay eşiğe göre: ≤2 %" + fastShare(allV, 2) +
  " · ≤3 %" + fastShare(allV, 3) + " · ≤5 %" + fastShare(allV, 5) +
  " · ≤8 %" + fastShare(allV, 8));
