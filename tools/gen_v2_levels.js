"use strict";

// v2 funnel üretici + dış format yazıcı (tek adım):
//   node tools/gen_v2_levels.js            → export_levels_v2/<n>_<t|e|m|h|vh>.json
//   TM_N=60 node tools/gen_v2_levels.js    → yalnız 1-60
//   TM_KEEP=1                              → var olan dosyaları atla (devam)
//   TM_OUT=<klasör>                        → başka çıkış klasörü
// Deterministik (level no → seed). export_levels/ ve export_levels_1010/
// klasörlerine ASLA yazmaz (güvenlik kilidi).
//
// Tasarım (tasarımcıyla kararlaştırıldı, Eki 2026):
//   etiket dizisi  1-20: t t t t h e m h e h e m h m h m m h m vh
//                  21+ : m e h e vh m m h m vh (sonsuz tekrar)
//   hedef süre     TASARIMCI saniyesi (js/flow.js playTime "designer" =
//                  sweep yükü / 10). Etiket başına start → plato, churn
//                  biçimli (concave) rampa level 5'te başlar 25'te doyar:
//                    e  20 → 35    m  40 → 55    h  60 → 85    vh 100 → 130
//   boyut          etiketten: e 6x8 (hedef ≤ 28) / 6x9 (üstü), m 7x10,
//                  h 8x12, vh 9x14 — 9x14 yalnız vh'de. Platolar boyutların
//                  ölçülen sert-reçete p90 tavanlarıdır (6x9 36, 7x10 55,
//                  8x12 85, 9x14 130); e platosu 40 istenmişti, 6x9'da
//                  çıkmadığı için 35. Kalıp (figüratif maske) yok; board
//                  tam dolu — çift sayısı sürenin ana kaldıracı, boyut
//                  içinde reçete ~2× oynatır.
//   ilk-boyut-yumuşak kuralı YOK (bilinçli: churn eğrisi istendi).
//
// Üretim: level başına CAND aday (reçete paleti hedefin boyut içindeki
// konumuna göre: düğüm sayısı, spanBias, cornerP, cephe modu, kesme),
// skor = |ölçülen − hedef| / hedef + GRIND_W × öğütme payı. Skor bandı
// içindeki adaylardan AÇILIŞ İMZASI pakete en uzak olan seçilir
// (çeşitlilik). Aşama B: seçilen aday mutasyonla (iki çiftin 4 hücresi
// yeniden eşlenir; dolu kalır) hedefe doğru itilir — hedefin altındaysa
// en ucuz hamlelerin çiftleri, üstündeyse en pahalıların nişan alınır.
//
// Çıktı: dış motor formatı (width, height, cells; index 0 sol alt; 0 dot,
// n≥1 çift id), 1-4 öğretici tutorial_levels/'tan stickers dahil kopya,
// funnel.csv (ad listesi) ve report.csv (hedef/ölçülen/oyuncu sn).
// Stickers: TM_OUT=export_levels_v2 node tools/assign_stickers.js, sonra
// aynı değişkenle check_stickers.js.

const fs = require("fs");
const path = require("path");
const { generateFullLevel } = require("../js/generator.js");
const { isAdjacentCollinear } = require("../js/board.js");
const { effortCurve, spanOf, isCollinear, playTime } = require("../js/flow.js");

const ROOT = path.join(__dirname, "..");
const OUT = path.resolve(ROOT, process.env.TM_OUT || "export_levels_v2");
const TUT_DIR = path.join(ROOT, "tutorial_levels");
const N = parseInt(process.env.TM_N || "200", 10);
const KEEP = !!process.env.TM_KEEP;

// güvenlik kilidi: eski setler korunur
for (const guarded of ["export_levels", "export_levels_1010", "old_export_levels"]) {
  if (OUT === path.resolve(ROOT, guarded)) {
    throw new Error("TM_OUT korunan klasöre işaret ediyor: " + guarded);
  }
}

// ── funnel planı ──
const HEAD = "t t t t h e m h e h e m h m h m m h m vh".split(" ");
const LOOP = "m e h e vh m m h m vh".split(" ");
const labelOf = (no) => (no <= HEAD.length ? HEAD[no - 1] : LOOP[(no - HEAD.length - 1) % LOOP.length]);

const CURVE = { e: [20, 35], m: [40, 55], h: [60, 85], vh: [100, 130] };
const RAMP_START = 5, RAMP_END = 25;
const ramp = (no) => {
  const t = Math.max(0, Math.min(1, (no - RAMP_START) / (RAMP_END - RAMP_START)));
  return 1 - (1 - t) * (1 - t); // churn biçimi: hızlı çıkar, platoya yaslanır
};
const targetOf = (no, label) => {
  const [a, b] = CURVE[label];
  return a + (b - a) * ramp(no);
};
// boyut: [cols, rows]; yumuşak p10 / sert p50 / sert p90 (tasarımcı sn, dolu board ölçümü)
const SIZE_CAP = {
  "6x8": { cols: 6, rows: 8, lo: 12, mid: 22, hi: 31 },
  "6x9": { cols: 6, rows: 9, lo: 14, mid: 27, hi: 38 },
  "7x10": { cols: 7, rows: 10, lo: 18, mid: 38, hi: 58 },
  "8x12": { cols: 8, rows: 12, lo: 26, mid: 58, hi: 88 },
  "9x14": { cols: 9, rows: 14, lo: 34, mid: 82, hi: 135 },
};
const sizeOf = (label, target) =>
  label === "e" ? (target <= 28 ? "6x8" : "6x9")
  : label === "m" ? "7x10" : label === "h" ? "8x12" : "9x14";

// ── üretim sabitleri ──
const CAND = 64;      // level başına aday
const GRIND_W = 0.6;  // öğütme payının skordaki ağırlığı (%10 öğütme ≈ %6 hedef sapması)
const GRIND_OK = 0.15; // bu payın altı "temiz" — mutasyon burada durabilir
const DIV_BAND = 0.04; // skor bandı: bu kadar yakın adaylar eşdeğer, imzası en uzak seçilir
const DONE_REL = 0.03; // hedefe göreli yakınlık — mutasyon burada durur
const mutBudget = (rows, cols) => Math.min(1500, Math.max(200, 6 * rows * cols));

function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Reçete paleti: hedefin boyut içindeki konumu h (0 = yumuşak taban,
// 1 = sert tavan) düğüm/spanBias havuzunu seçer; diğer eksenler aday
// indeksiyle döner (çeşitlilik). Ölçüm: düğüm 0→6 yükü ~2×, 6-14 plato;
// düşük spanBias büyük boardda daha sert; cornerP tek başına az etkili.
function recipeOf(cap, target, cand) {
  const h = Math.max(0, Math.min(1, (target - cap.lo) / (cap.hi - cap.lo)));
  const knotPool = h < 0.35 ? [0, 2, 3, 4] : h < 0.6 ? [3, 4, 6, 8] : [6, 8, 10, 14];
  const sbPool = h < 0.6 ? [0.3, 0.6, 0.9] : [0.3, 0.3, 0.6, 0.9];
  const cpPool = [0.6, 0.8, 1.0];
  const fmPool = ["bolge", "yilan", "cepheler"];
  const cutPool = [null, "dikey", "yatay", null];
  return {
    knots: knotPool[cand % knotPool.length],
    spanBias: sbPool[Math.floor(cand / 4) % sbPool.length],
    cornerP: cpPool[Math.floor(cand / 12) % cpPool.length],
    frontMode: fmPool[Math.floor(cand / 3) % fmPool.length],
    cut: cutPool[Math.floor(cand / 2) % cutPool.length],
    entryN: 1 + (h < 0.5 ? cand % 2 : 0),
    frontBias: cand % 5 === 4 ? 0.85 : 1.0,
  };
}

// öğütme payı (gen_effort_levels.js ile aynı tanım): art arda uzun mesafe
// match hamlelerinin payı
function grindShare(ecS, pairs, rows, cols) {
  const LONG = Math.ceil(0.5 * Math.max(rows, cols));
  const L = ecS.moves.length;
  const isLong = ecS.moves.map((m) => m.pairIds.every((pid) => spanOf(pairs[pid]) >= LONG));
  let n = 0;
  for (let t = 0; t < L; t++) {
    if (isLong[t] && ((t > 0 && isLong[t - 1]) || (t + 1 < L && isLong[t + 1]))) n++;
  }
  return n / L;
}

// açılış imzası (ilk 6 hamle): span, köşe payı, tap satırı, tap sütunu — 0..1
function sigOf(ecS, pairs, rows, cols) {
  const K = Math.min(6, ecS.moves.length);
  const maxDim = Math.max(rows, cols);
  let span = 0, corner = 0, np = 0, pr = 0, pc = 0;
  for (let t = 0; t < K; t++) {
    const mv = ecS.moves[t];
    pr += mv.r / (rows - 1);
    pc += mv.c / (cols - 1);
    for (const pid of mv.pairIds) {
      span += spanOf(pairs[pid]) / maxDim;
      corner += isCollinear(pairs[pid]) ? 0 : 1;
      np++;
    }
  }
  return [span / np, corner / np, pr / K, pc / K];
}
const sigDist = (a, b) => Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0) / a.length);

// ölçüm: tasarımcı saniyesi (sweep yükü/10) + öğütme + skor
function measure(pairs, rows, cols, target) {
  const ecS = effortCurve(pairs, rows, cols, null, "sweep");
  if (!ecS) return null; // tıkalı
  const sec = ecS.effortMean * pairs.length / 10;
  const grind = grindShare(ecS, pairs, rows, cols);
  return { sec, grind, ecS, key: Math.abs(sec - target) / target + GRIND_W * grind };
}

// mutasyon nişanı: hedefin altındaysak en ucuz hamlelerin çiftleri, üstünde
// isek en pahalıların (±2 adım)
function guidePairs(ecS, below) {
  const eff = ecS.effort, L = eff.length;
  let idx = 0;
  for (let i = 1; i < L; i++) if (below ? eff[i] < eff[idx] : eff[i] > eff[idx]) idx = i;
  const ids = [];
  for (let i = Math.max(0, idx - 2); i <= Math.min(L - 1, idx + 2); i++) ids.push(...ecS.moves[i].pairIds);
  return ids;
}
function mutateOnce(pairs, rng, guide) {
  const n = pairs.length;
  let i = guide.length && rng() < 0.5 ? guide[Math.floor(rng() * guide.length)] : Math.floor(rng() * n);
  let j = Math.floor(rng() * (n - 1));
  if (j >= i) j++;
  const [a1, a2] = pairs[i], [b1, b2] = pairs[j];
  const alt = rng() < 0.5 ? [[a1, b1], [a2, b2]] : [[a1, b2], [a2, b1]];
  if (isAdjacentCollinear(alt[0]) || isAdjacentCollinear(alt[1])) return null;
  const next = pairs.slice();
  next[i] = alt[0];
  next[j] = alt[1];
  return next;
}
function refine(pairs, m, rows, cols, target, rng) {
  let cur = { pairs, m }, accepted = 0;
  const budget = mutBudget(rows, cols);
  // durma: hedef tutturuldu VE öğütme kabul edilebilir — aksi halde bütçe
  // bitene dek skor (hedef sapması + öğütme) iyileştirilir
  const done = (m) => Math.abs(m.sec - target) / target <= DONE_REL && m.grind <= GRIND_OK;
  for (let e = 0; e < budget && !done(cur.m); e++) {
    const next = mutateOnce(cur.pairs, rng, guidePairs(cur.m.ecS, cur.m.sec < target));
    if (!next) continue;
    const nm = measure(next, rows, cols, target);
    if (!nm || nm.key >= cur.m.key - 1e-9) continue;
    cur = { pairs: next, m: nm };
    accepted++;
  }
  return { ...cur, accepted };
}

// ── yazım ──
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
      ? ',\n  "stickers": [\n' + stickers.map((s) => "    " + JSON.stringify(s)).join(",\n") + "\n  ]"
      : "") +
    "\n}\n";
  fs.writeFileSync(path.join(OUT, no + "_" + letter + ".json"), json);
}
const cellsOf = (pairs, rows, cols) => {
  const cells = new Array(rows * cols).fill(0);
  pairs.forEach((pair, pi) => {
    for (const [r, c] of pair) cells[(rows - 1 - r) * cols + c] = pi + 1;
  });
  return cells;
};
const FILE_RE = /^(\d+)_(t|e|m|h|vh)\.json$/;

fs.mkdirSync(OUT, { recursive: true });
if (!KEEP) {
  for (const f of fs.readdirSync(OUT)) if (FILE_RE.test(f)) fs.unlinkSync(path.join(OUT, f));
}
const existing = new Map();
for (const f of fs.readdirSync(OUT)) {
  const m = f.match(FILE_RE);
  if (m) existing.set(parseInt(m[1], 10), f);
}

// 1-4: öğreticiler
for (let i = 1; i <= Math.min(4, N); i++) {
  if (KEEP && existing.has(i)) continue;
  const t = JSON.parse(fs.readFileSync(path.join(TUT_DIR, i + "_t.json"), "utf8"));
  writeLevel(i, "t", t.width, t.height, t.cells, Math.max(...t.cells), t.stickers);
}

// 5..N
const report = [];
const chosenSigs = [];
const t0 = Date.now();
for (let no = 5; no <= N; no++) {
  const label = labelOf(no);
  const target = targetOf(no, label);
  const sizeKey = sizeOf(label, target);
  const cap = SIZE_CAP[sizeKey];
  const { rows, cols } = cap;
  if (KEEP && existing.has(no)) {
    // devam: var olan dosyayı ölç, rapora al
    const j = JSON.parse(fs.readFileSync(path.join(OUT, existing.get(no)), "utf8"));
    const byId = {};
    j.cells.forEach((v, i) => { if (v > 0) (byId[v] = byId[v] || []).push([j.height - 1 - Math.floor(i / j.width), i % j.width]); });
    const pairs = Object.keys(byId).sort((a, b) => a - b).map((k) => byId[k]);
    const m = measure(pairs, j.height, j.width, target);
    const pt = playTime(pairs, j.height, j.width);
    report.push({ no, label, size: j.width + "x" + j.height, pairs: pairs.length, target, sec: m ? m.sec : NaN, player: pt ? pt.playerSeconds : NaN, grind: m ? m.grind : NaN, cand: -1, mut: 0 });
    if (m) chosenSigs.push(sigOf(m.ecS, pairs, j.height, j.width));
    continue;
  }
  const tl = Date.now();
  // Aşama A: aday havuzu
  const pool = [];
  for (let cand = 0; cand < CAND; cand++) {
    const rec = recipeOf(cap, target, cand);
    const lv = generateFullLevel({
      rows, cols, mask: null, seed: hashSeed("v2:" + no + ":" + cand),
      entryN: rec.entryN, frontMode: rec.frontMode, frontBias: rec.frontBias,
      cornerP: rec.cornerP, spanBias: rec.spanBias, knots: rec.knots, cut: rec.cut,
    });
    if (!lv) continue;
    const m = measure(lv.pairs, rows, cols, target);
    if (!m) continue;
    pool.push({ pairs: lv.pairs, maskArea: lv.maskArea, m, cand, rec, sig: sigOf(m.ecS, lv.pairs, rows, cols) });
  }
  if (!pool.length) throw new Error("aday bulunamadı: level " + no);
  pool.sort((a, b) => a.m.key - b.m.key || a.cand - b.cand);
  const elite = pool.filter((p) => p.m.key <= pool[0].m.key + DIV_BAND);
  let best = elite[0], bestD = -1;
  if (chosenSigs.length) {
    for (const p of elite) {
      const dMin = Math.min(...chosenSigs.map((s) => sigDist(p.sig, s)));
      if (dMin > bestD + 1e-12) { bestD = dMin; best = p; }
    }
  }
  // sözleşme: generateFullLevel maske alanını tam doldurur (8x12 gibi tek
  // parite durumlarında üretici 1 çiftlik boşluk bırakabilir → maskArea)
  if (best.pairs.length * 2 !== best.maskArea) throw new Error("doluluk bozuk: level " + no);

  // Aşama B: hedefe doğru mutasyon
  const ref = refine(best.pairs, best.m, rows, cols, target, mulberry32(hashSeed("v2-mut:" + no)));
  const cellSet = new Set(ref.pairs.flat().map(([r, c]) => r * cols + c));
  if (ref.pairs.length !== best.pairs.length || cellSet.size !== ref.pairs.length * 2) {
    throw new Error("mutasyon doluluğu bozdu: level " + no);
  }
  chosenSigs.push(sigOf(ref.m.ecS, ref.pairs, rows, cols));
  const pt = playTime(ref.pairs, rows, cols);

  writeLevel(no, label, cols, rows, cellsOf(ref.pairs, rows, cols), ref.pairs.length, null);
  report.push({ no, label, size: sizeKey, pairs: ref.pairs.length, target, sec: ref.m.sec,
                player: pt ? pt.playerSeconds : NaN, grind: ref.m.grind, cand: best.cand, mut: ref.accepted });
  console.log(
    String(no).padStart(3) + " " + label.padEnd(2) + " " + sizeKey.padEnd(5) +
    " çift " + String(ref.pairs.length).padEnd(3) +
    " hedef " + target.toFixed(0).padStart(3) + " ölçülen " + ref.m.sec.toFixed(0).padStart(3) +
    " (A " + best.m.sec.toFixed(0) + ")" +
    " öğütme %" + String(Math.round(100 * ref.m.grind)).padStart(2) +
    " oyuncu~" + (pt ? pt.playerSeconds.toFixed(0) : "?") +
    " mut " + String(ref.accepted).padEnd(3) + ((Date.now() - tl) / 1000).toFixed(1) + "s");
}

// funnel.csv (ad listesi, numara sırası) + report.csv
const all = fs.readdirSync(OUT)
  .filter((f) => FILE_RE.test(f))
  .map((f) => f.replace(".json", ""))
  .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
fs.writeFileSync(path.join(OUT, "funnel.csv"), all.join(",") + "\n");
fs.writeFileSync(path.join(OUT, "report.csv"),
  "no,label,size,pairs,target_sec,measured_sec,player_sec,grind,cand,mut\n" +
  report.map((r) => [r.no, r.label, r.size, r.pairs, r.target.toFixed(1), r.sec.toFixed(1),
    r.player.toFixed(0), r.grind.toFixed(3), r.cand, r.mut].join(",")).join("\n") + "\n");

// özet
const byLabel = {};
for (const r of report) (byLabel[r.label] = byLabel[r.label] || []).push(r);
console.log("\n" + ((Date.now() - t0) / 1000).toFixed(0) + " sn — " + report.length + " level");
for (const l of ["e", "m", "h", "vh"]) {
  const g = byLabel[l]; if (!g) continue;
  const miss = g.map((r) => r.sec - r.target);
  const rmse = Math.sqrt(miss.reduce((a, x) => a + x * x, 0) / g.length);
  const plateau = g.filter((r) => r.no >= RAMP_END);
  console.log("  " + l.padEnd(2) + " n " + String(g.length).padEnd(3) +
    " hedef−ölçülen RMSE " + rmse.toFixed(1) + " sn, en kötü " +
    Math.max(...miss.map(Math.abs)).toFixed(0) + " sn" +
    (plateau.length ? "; plato ort ölçülen " + (plateau.reduce((a, r) => a + r.sec, 0) / plateau.length).toFixed(0) +
      " / hedef " + CURVE[l][1] : ""));
}
console.log("yazıldı: " + path.relative(ROOT, OUT) + "/ (" + all.length + " dosya) + funnel.csv + report.csv");
console.log("stickers: TM_OUT=" + path.relative(ROOT, OUT) + " node tools/assign_stickers.js && TM_OUT=" +
  path.relative(ROOT, OUT) + " node tools/check_stickers.js");
