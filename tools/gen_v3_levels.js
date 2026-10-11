"use strict";

// v3 funnel üretici — Tile Generator'lı levellar (tek adım, dış format):
//   node tools/gen_v3_levels.js            → export_levels_v3/<n>_<t|e|m|h|vh>.json
//   TM_N=60 node tools/gen_v3_levels.js    → yalnız 1-60
//   TM_KEEP=1                              → var olan dosyaları atla (devam)
//   TM_OUT=<klasör>                        → başka çıkış klasörü
// Deterministik (level no → seed). export_levels/, export_levels_1010/,
// old_export_levels/, export_levels_v2/ klasörlerine ASLA yazmaz.
//
// Tasarım (tasarımcıyla kararlaştırıldı, Eki 2026):
//   etiket dizisi  v2 ile aynı (1-20 HEAD, 21+ LOOP).
//   hedef süre     TASARIMCI saniyesi (sweep yükü / 10), eğri ilk istenen:
//                    e 20 → 40   m 40 → 60   h 60 → 120   vh 100 → 180
//                  churn biçimli rampa level 5 → 25.
//   boyut          küçültüldü, 9x14 yok: e 6x8 (≤32) / 6x9, m 7x10,
//                  h 7x10 (≤85) / 8x12, vh 8x12. Generator'lı tavanlar
//                  (tasarımcı sn, rastgele kalıp taraması p50/p90/max):
//                  6x8 31/43/57 · 6x9 37/55/71 · 7x10 63/100/124 ·
//                  8x12 97/162/187 — saf board p90'ının ~2 katı.
//   generator      "lazım oldukça": önce saf board denenir; hedefe
//                  %3 içinde ulaşamazsa generator kalıpları devreye girer.
//                  İlk generator görünümü yumuşak (≤2 generator, kısa
//                  kuyruk, hemen eşleşen taşlar) — oyuncu sayaçtan öğrenir.
//   sürpriz        oyuncu kuyruktaki taşı görmez (yalnız sayaç) → kalıp
//                  "gecikme" (near/mid/far) basılan taşın eşinin kaç hamle
//                  sonra görünür olacağını belirler; far = arama yükü.
//
// Kalıp aileleri (tools/v3_gen_lib.js applySpec):
//   yerleşim  edge (kenardan içeri) · corner (köşe) · inner (iç, ada) ·
//             mixed · facing (karşılıklı koridor)
//   kuyruk    queueLen (derinlik), pick = near/mid/far/alt/random (gecikme)
//   doldurma  none (seyrek board) · singles (boşalan hücreye yeni tek taş,
//             eşi kuyruğa → çift sayısı artar) · pairs (yeni tam çiftler)
//   senkron   syncN: bir çiftin iki taşı iki ayrı kuyruğa
// Her kalıp simülasyonla doğrulanır (monotonluk → tek greedy koşu çözümü
// kanıtlar; null = tıkalı → aday elenir).
//
// Üretim: level başına saf adaylar (v2 reçete paleti) → yetmezse
// generator'lı adaylar (kalıp havuzu hedefin generator tavanı içindeki
// konumuna göre) → en iyi aday reçete/kalıp varyasyonu + çift mutasyonu
// (yalnız boarddaki tam çiftler; her adım doğrulanır) ile hedefe itilir.
// Skor = |ölçülen − hedef| / hedef + GRIND_W × öğütme + çeşitlilik cezası
// (aynı etikette son 3 levelın kalıp imzası).
//
// Çıktı: dış format + TileGenerators [{ Cell, Direction, Tiles }] (Cell
// index 0 sol alt; Direction 0 yukarı 1 aşağı 2 sol 3 sağ; Tiles 1 tabanlı
// çift kimlikleri üretim sırasıyla; generator hücresi cells'te 0),
// funnel.csv, report.csv. Stickers: TM_OUT=export_levels_v3
// node tools/assign_stickers.js && TM_OUT=export_levels_v3 node tools/check_stickers.js

const fs = require("fs");
const path = require("path");
const { isAdjacentCollinear, levelFromExternal, generatorIssues, GEN_DIR_CODES } = require("../js/board.js");
const { effortCurve, spanOf, isCollinear, playTime } = require("../js/flow.js");
const { hashSeed, mulberry32, buildLevel, measureLevel } = require("./v3_gen_lib.js");

const ROOT = path.join(__dirname, "..");
const OUT = path.resolve(ROOT, process.env.TM_OUT || "export_levels_v3");
const TUT_DIR = path.join(ROOT, "tutorial_levels");
const N = parseInt(process.env.TM_N || "200", 10);
const KEEP = !!process.env.TM_KEEP;

for (const guarded of ["export_levels", "export_levels_1010", "old_export_levels", "export_levels_v2"]) {
  if (OUT === path.resolve(ROOT, guarded)) throw new Error("TM_OUT korunan klasöre işaret ediyor: " + guarded);
}

// ── funnel planı ──
const HEAD = "t t t t h e m h e h e m h m h m m h m vh".split(" ");
const LOOP = "m e h e vh m m h m vh".split(" ");
const labelOf = (no) => (no <= HEAD.length ? HEAD[no - 1] : LOOP[(no - HEAD.length - 1) % LOOP.length]);

const CURVE = { e: [20, 40], m: [40, 60], h: [60, 120], vh: [100, 180] };
const RAMP_START = 5, RAMP_END = 25;
const ramp = (no) => {
  const t = Math.max(0, Math.min(1, (no - RAMP_START) / (RAMP_END - RAMP_START)));
  return 1 - (1 - t) * (1 - t);
};
const targetOf = (no, label) => { const [a, b] = CURVE[label]; return a + (b - a) * ramp(no); };

// boyut tavanları: saf (lo p10 / mid p50 / hi p90) ve generator'lı (gHi p90, gMax)
const SIZE_CAP = {
  "6x8":  { cols: 6, rows: 8,  lo: 12, mid: 22, hi: 31, gMid: 31, gHi: 43,  gMax: 57 },
  "6x9":  { cols: 6, rows: 9,  lo: 14, mid: 27, hi: 38, gMid: 37, gHi: 55,  gMax: 71 },
  "7x10": { cols: 7, rows: 10, lo: 18, mid: 38, hi: 58, gMid: 63, gHi: 100, gMax: 124 },
  "8x12": { cols: 8, rows: 12, lo: 26, mid: 58, hi: 88, gMid: 97, gHi: 162, gMax: 187 },
};
const sizeOf = (label, target) =>
  label === "e" ? (target <= 32 ? "6x8" : "6x9")
  : label === "m" ? "7x10"
  : label === "h" ? (target <= 85 ? "7x10" : "8x12")
  : "8x12";

// ── üretim sabitleri ──
const CAND_PURE = 24;    // saf aday
const CAND_GEN = 28;     // generator'lı aday
const REFINE_ROUNDS = 10; // kalıp/reçete varyasyonu turu
const GRIND_W_PURE = 0.6, GRIND_OK_PURE = 0.15;
const GRIND_W_GEN = 0.4, GRIND_OK_GEN = 0.25; // basım eşleşmeleri ölçüden çıkarılır (grindShare)
const DONE_REL = 0.03;
const DIV_PEN = 0.04;    // aynı kalıp imzası (etiket içinde son 3 level) cezası
const INTRO_LEVEL = 6;   // generator tanıtım levelı (ilk e)
const mutBudget = (rows, cols) => Math.min(400, Math.max(120, 3 * rows * cols));

// v2 reçete paleti (saf board)
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

// Kalıp havuzu: hg = hedefin generator tavanı içindeki konumu
// (0 = saf p50, 1 = generator p90). intro: ilk görünüm yumuşak.
const PLACEMENTS = ["edge", "corner", "inner", "mixed", "facing"];
function specOf(cap, target, cand, rng, intro) {
  const hg = Math.max(0, Math.min(1.2, (target - cap.mid) / (cap.gHi - cap.mid)));
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  if (intro) {
    return { placement: pick(["edge", "corner"]), genN: 1 + (cand % 2), queueLen: 2 + (cand % 2),
             pick: "near", refill: "none", refillFrac: 1, syncN: 0, queueMax: 4 };
  }
  const genN = hg < 0.3 ? pick([1, 2, 2]) : hg < 0.6 ? pick([2, 3, 3]) : hg < 0.9 ? pick([3, 4, 4, 5]) : pick([4, 5, 6]);
  const queueLen = hg < 0.3 ? pick([2, 3, 4]) : hg < 0.6 ? pick([4, 6, 8]) : pick([8, 12, 16]);
  const pk = hg < 0.3 ? pick(["near", "near", "mid", "alt"])
    : hg < 0.6 ? pick(["near", "mid", "alt", "random", "far"])
    : pick(["mid", "far", "alt", "random", "random"]);
  const refill = hg < 0.3 ? pick(["none", "none", "pairs"])
    : hg < 0.6 ? pick(["none", "pairs", "singles"])
    : pick(["singles", "singles", "pairs"]);
  const placement = PLACEMENTS[(cand + Math.floor(rng() * 2)) % PLACEMENTS.length];
  const syncN = genN >= 2 ? (hg < 0.5 ? pick([0, 0, 1]) : pick([0, 1, 2])) : 0;
  return { placement, genN: placement === "facing" ? Math.max(2, genN) : genN, queueLen, pick: pk,
           refill, refillFrac: pick([0.5, 1]), syncN, queueMax: queueLen + (hg > 0.8 ? 8 : 4) };
}
const specSig = (s) => s ? s.placement + "|" + s.genN + "|" + s.pick + "|" + s.refill : "pure";

// Kalıp varyasyonu (iyileştirme turu): bir ekseni oynat
function varySpec(spec, below, rng) {
  const s = { ...spec };
  const r = rng();
  if (r < 0.3) s.queueLen = Math.max(1, s.queueLen + (below ? 2 : -2));
  else if (r < 0.5) s.genN = Math.max(s.placement === "facing" ? 2 : 1, Math.min(6, s.genN + (below ? 1 : -1)));
  else if (r < 0.7) s.refill = below ? (s.refill === "none" ? "pairs" : "singles") : (s.refill === "singles" ? "pairs" : "none");
  else if (r < 0.85) s.pick = below ? (s.pick === "near" ? "mid" : "far") : (s.pick === "far" ? "mid" : "near");
  else s.placement = PLACEMENTS[Math.floor(rng() * PLACEMENTS.length)];
  if (s.placement === "facing") s.genN = Math.max(2, s.genN);
  s.queueMax = s.queueLen + 4;
  return s;
}

// ── ölçüm / skor ──
// öğütme payı: art arda uzun mesafe eşleşmelerin payı. Basılan taşın
// eşleşmesi (ön hücreden) mekaniğin doğası — uzun sayılmaz.
function grindShare(ecS, pairs, rows, cols, gens) {
  const LONG = Math.ceil(0.5 * Math.max(rows, cols));
  const fronts = new Set((gens || []).map((g) =>
    (g.r + { U: -1, D: 1, L: 0, R: 0 }[g.dir]) * cols + g.c + { U: 0, D: 0, L: -1, R: 1 }[g.dir]));
  const spawnPair = (pid) => pairs[pid].some((t) => fronts.has(t[0] * cols + t[1]));
  const L = ecS.moves.length;
  const isLong = ecS.moves.map((m) => m.pairIds.every((pid) => !spawnPair(pid) && spanOf(pairs[pid]) >= LONG));
  let n = 0;
  for (let t = 0; t < L; t++) if (isLong[t] && ((t > 0 && isLong[t - 1]) || (t + 1 < L && isLong[t + 1]))) n++;
  return n / L;
}
function measure(lv, rows, cols, target, recentSigs, spec) {
  const gens = lv.generators || null;
  const ecS = effortCurve(lv.pairs, rows, cols, null, "sweep", gens);
  if (!ecS) return null;
  const sec = ecS.effortMean * lv.pairs.length / 10;
  const grind = grindShare(ecS, ecS.pairs, rows, cols, gens);
  const gw = gens ? GRIND_W_GEN : GRIND_W_PURE;
  const div = recentSigs.includes(specSig(spec)) ? DIV_PEN : 0;
  const relErr = Math.abs(sec - target) / target;
  return { sec, grind, ecS, relErr, key: relErr + gw * grind + div };
}
const isDone = (m, gens) => m.relErr <= DONE_REL && m.grind <= (gens ? GRIND_OK_GEN : GRIND_OK_PURE);

// ── çift mutasyonu (yalnız boarddaki tam çiftler; generator/ön hücreleri sabit) ──
function mutateOnce(lv, rows, cols, rng, guide) {
  const K = (r, c) => r * cols + c;
  const locked = new Set();
  for (const g of lv.generators || []) {
    locked.add(K(g.r, g.c));
    locked.add(K(g.r + { U: -1, D: 1, L: 0, R: 0 }[g.dir], g.c + { U: 0, D: 0, L: -1, R: 1 }[g.dir]));
  }
  const okPair = (p) => p.length === 2 && !p.some((t) => locked.has(K(t[0], t[1])));
  const eligible = [];
  lv.pairs.forEach((p, i) => { if (okPair(p)) eligible.push(i); });
  if (eligible.length < 2) return null;
  const gl = guide.filter((i) => okPair(lv.pairs[i]));
  const i = gl.length && rng() < 0.5 ? gl[Math.floor(rng() * gl.length)] : eligible[Math.floor(rng() * eligible.length)];
  let j = eligible[Math.floor(rng() * eligible.length)];
  if (j === i) return null;
  const [a1, a2] = lv.pairs[i], [b1, b2] = lv.pairs[j];
  const alt = rng() < 0.5 ? [[a1, b1], [a2, b2]] : [[a1, b2], [a2, b1]];
  if (isAdjacentCollinear(alt[0]) || isAdjacentCollinear(alt[1])) return null;
  const next = lv.pairs.slice();
  next[i] = alt[0]; next[j] = alt[1];
  return { pairs: next, generators: lv.generators, maskArea: lv.maskArea };
}
function guidePairs(ecS, below) {
  const eff = ecS.effort, L = eff.length;
  let idx = 0;
  for (let i = 1; i < L; i++) if (below ? eff[i] < eff[idx] : eff[i] > eff[idx]) idx = i;
  const ids = [];
  for (let i = Math.max(0, idx - 2); i <= Math.min(L - 1, idx + 2); i++) ids.push(...ecS.moves[i].pairIds);
  return ids;
}
function mutate(cur, rows, cols, target, recentSigs, rng) {
  let accepted = 0;
  const budget = mutBudget(rows, cols);
  for (let e = 0; e < budget && !isDone(cur.m, cur.lv.generators); e++) {
    const next = mutateOnce(cur.lv, rows, cols, rng, guidePairs(cur.m.ecS, cur.m.sec < target));
    if (!next) continue;
    const nm = measure(next, rows, cols, target, recentSigs, cur.spec);
    if (!nm || nm.key >= cur.m.key - 1e-9) continue;
    if (next.generators && generatorIssues({ rows, cols, pairs: next.pairs, generators: next.generators }).length) continue;
    cur = { ...cur, lv: next, m: nm };
    accepted++;
  }
  return { ...cur, accepted };
}

// ── yazım ──
const DIR_CODE = Object.fromEntries(GEN_DIR_CODES.map((d, i) => [d, i]));
function extOf(lv, rows, cols) {
  const cells = new Array(rows * cols).fill(0);
  lv.pairs.forEach((pair, pi) => { for (const [r, c] of pair) cells[(rows - 1 - r) * cols + c] = pi + 1; });
  const ext = { width: cols, height: rows, cells };
  if (lv.generators && lv.generators.length) {
    ext.TileGenerators = lv.generators.map((g) => ({
      Cell: (rows - 1 - g.r) * cols + g.c, Direction: DIR_CODE[g.dir], Tiles: g.queue.map((p) => p + 1),
    }));
  }
  return ext;
}
function writeExt(no, letter, ext, stickers) {
  const pairsN = Math.max(0, ...ext.cells, ...(ext.TileGenerators || []).flatMap((g) => g.Tiles));
  const w = String(pairsN).length + 1;
  const rowsTxt = [];
  for (let rr = 0; rr < ext.height; rr++) {
    const row = ext.cells.slice(rr * ext.width, (rr + 1) * ext.width);
    rowsTxt.push("    " + row.map((v) => String(v).padStart(w)).join(","));
  }
  const json =
    "{\n" +
    '  "width": ' + ext.width + ",\n" +
    '  "height": ' + ext.height + ",\n" +
    '  "cells": [\n' + rowsTxt.join(",\n") + "\n  ]" +
    (stickers ? ',\n  "stickers": [\n' + stickers.map((s) => "    " + JSON.stringify(s)).join(",\n") + "\n  ]" : "") +
    (ext.TileGenerators
      ? ',\n  "TileGenerators": [\n' + ext.TileGenerators.map((g) => "    " + JSON.stringify(g)).join(",\n") + "\n  ]"
      : "") +
    "\n}\n";
  fs.writeFileSync(path.join(OUT, no + "_" + letter + ".json"), json);
}
const FILE_RE = /^(\d+)_(t|e|m|h|vh)\.json$/;

// son doğrulama: dosyadan geri okunan level yerleşim + çözüm testini geçmeli
function verifyExt(ext) {
  const lv = levelFromExternal(ext);
  const issues = generatorIssues(lv);
  if (issues.length) return "yerleşim: " + issues[0];
  if (!effortCurve(lv.pairs, lv.rows, lv.cols, null, "sweep", lv.generators)) return "tıkalı";
  const cnt = lv.pairs.map((p) => p.length);
  for (const g of lv.generators || []) for (const pid of g.queue) cnt[pid]++;
  if (cnt.some((n) => n !== 2)) return "çift sayımı bozuk";
  return null;
}

fs.mkdirSync(OUT, { recursive: true });
if (!KEEP) for (const f of fs.readdirSync(OUT)) if (FILE_RE.test(f)) fs.unlinkSync(path.join(OUT, f));
const existing = new Map();
for (const f of fs.readdirSync(OUT)) { const m = f.match(FILE_RE); if (m) existing.set(parseInt(m[1], 10), f); }

for (let i = 1; i <= Math.min(4, N); i++) {
  if (KEEP && existing.has(i)) continue;
  const t = JSON.parse(fs.readFileSync(path.join(TUT_DIR, i + "_t.json"), "utf8"));
  writeExt(i, "t", { width: t.width, height: t.height, cells: t.cells }, t.stickers);
}

const report = [];
const recentByLabel = { e: [], m: [], h: [], vh: [] };
const t0 = Date.now();
for (let no = 5; no <= N; no++) {
  const label = labelOf(no);
  const target = targetOf(no, label);
  const sizeKey = sizeOf(label, target);
  const cap = SIZE_CAP[sizeKey];
  const { rows, cols } = cap;
  const recentSigs = recentByLabel[label].slice(-3);
  if (KEEP && existing.has(no)) {
    const ext = JSON.parse(fs.readFileSync(path.join(OUT, existing.get(no)), "utf8"));
    const lv = levelFromExternal(ext);
    const m = measure(lv, lv.rows, lv.cols, target, [], null);
    const pt = playTime(lv.pairs, lv.rows, lv.cols, "player", lv.generators);
    const gens = lv.generators || [];
    report.push({ no, label, size: ext.width + "x" + ext.height, pairs: lv.pairs.length, target, sec: m ? m.sec : NaN,
                  player: pt ? pt.playerSeconds : NaN, grind: m ? m.grind : NaN, gens: gens.length,
                  queued: gens.reduce((a, g) => a + g.queue.length, 0), spec: "(keep)", mut: 0 });
    continue;
  }
  const tl = Date.now();
  const rngL = mulberry32(hashSeed("v3:" + no));
  const pool = [];
  // Aşama A1: saf adaylar
  for (let cand = 0; cand < CAND_PURE; cand++) {
    const rec = recipeOf(cap, target, cand);
    const lv = buildLevel(rows, cols, rec, null, hashSeed("v3p:" + no + ":" + cand));
    if (!lv) continue;
    const m = measure(lv, rows, cols, target, recentSigs, null);
    if (!m) continue;
    pool.push({ lv, m, rec, spec: null, cand });
  }
  // saf en iyi: hedefe en yakın (öğütme mutasyonda düzelir; "lazım oldukça"
  // kuralı için yakınlık esas)
  pool.sort((a, b) => a.m.relErr - b.m.relErr || a.m.key - b.m.key);
  let pureBest = pool[0];
  // saf aday hedefe %8 içindeyse mutasyonla itilir — tutarsa generator
  // gerekmez ("lazım oldukça")
  if (pureBest && !isDone(pureBest.m, null) && pureBest.m.relErr <= 0.08) {
    const pm = mutate(pureBest, rows, cols, target, recentSigs, mulberry32(hashSeed("v3-pmut:" + no)));
    if (isDone(pm.m, null)) { pureBest = pm; pool[0] = pm; }
  }
  // tanıtım: ilk e levelı (öğreticilerden sonra, no 6) generator'ı
  // kontrollü tanıtır — 1 generator, kısa kuyruk, hemen eşleşen taşlar.
  // Saf board yetse de kullanılır; sonrası "lazım oldukça".
  const intro = no === INTRO_LEVEL;
  const pureOk = !intro && pureBest && isDone(pureBest.m, null);
  // Aşama A2: generator'lı adaylar
  if (!pureOk) {
    if (intro) pool.length = 0; // saf adaylar yarışmasın
    for (let cand = 0; cand < CAND_GEN; cand++) {
      // taban reçete: saf paletin sert ucu (hedef saf tavanı aşıyorsa)
      const rec = recipeOf(cap, Math.min(target, cap.hi), cand);
      const spec = specOf(cap, target, cand, rngL, intro);
      const lv = buildLevel(rows, cols, rec, spec, hashSeed("v3g:" + no + ":" + cand));
      if (!lv) continue;
      const m = measure(lv, rows, cols, target, recentSigs, spec);
      if (!m) continue;
      pool.push({ lv, m, rec, spec, cand });
    }
  }
  if (!pool.length) throw new Error("aday bulunamadı: level " + no);
  pool.sort((a, b) => a.m.key - b.m.key || a.cand - b.cand);
  let best = pool[0];
  // Aşama B: kalıp/reçete varyasyonu (generator'lı ise)
  let varied = 0;
  if (best.spec && !intro && !isDone(best.m, best.lv.generators)) {
    for (let r = 0; r < REFINE_ROUNDS && !isDone(best.m, best.lv.generators); r++) {
      const spec = varySpec(best.spec, best.m.sec < target, rngL);
      const rec = recipeOf(cap, Math.min(target, cap.hi), best.cand + r + 1);
      const lv = buildLevel(rows, cols, rec, spec, hashSeed("v3r:" + no + ":" + r));
      if (!lv) continue;
      const m = measure(lv, rows, cols, target, recentSigs, spec);
      if (!m || m.key >= best.m.key) continue;
      best = { lv, m, rec, spec, cand: best.cand };
      varied++;
    }
  }
  // Aşama C: çift mutasyonu
  const ref = mutate(best, rows, cols, target, recentSigs, mulberry32(hashSeed("v3-mut:" + no)));
  const lv = ref.lv;
  const gens = lv.generators || [];
  const ext = extOf(lv, rows, cols);
  const bad = verifyExt(ext);
  if (bad) throw new Error("doğrulama: level " + no + " — " + bad);
  // çift sayımı: boarddaki + kuyruktaki = 2·çift
  const onBoard = lv.pairs.reduce((a, p) => a + p.length, 0);
  const queued = gens.reduce((a, g) => a + g.queue.length, 0);
  if (onBoard + queued !== 2 * lv.pairs.length) throw new Error("taş sayımı bozuk: level " + no);
  const pt = playTime(lv.pairs, rows, cols, "player", gens.length ? gens : undefined);
  recentByLabel[label].push(specSig(ref.spec));

  writeExt(no, label, ext, null);
  report.push({ no, label, size: sizeKey, pairs: lv.pairs.length, target, sec: ref.m.sec,
                player: pt ? pt.playerSeconds : NaN, grind: ref.m.grind, gens: gens.length, queued,
                spec: specSig(ref.spec), mut: ref.accepted });
  console.log(
    String(no).padStart(3) + " " + label.padEnd(2) + " " + sizeKey.padEnd(5) +
    " çift " + String(lv.pairs.length).padEnd(3) +
    " hedef " + target.toFixed(0).padStart(3) + " ölçülen " + ref.m.sec.toFixed(0).padStart(3) +
    (pureBest ? " (saf " + pureBest.m.sec.toFixed(0) + ")" : "") +
    " öğütme %" + String(Math.round(100 * ref.m.grind)).padStart(2) +
    " oyuncu~" + (pt ? pt.playerSeconds.toFixed(0) : "?") +
    " gen " + gens.length + " kuyruk " + String(queued).padEnd(3) + specSig(ref.spec).padEnd(24) +
    " var " + varied + " mut " + String(ref.accepted).padEnd(3) + ((Date.now() - tl) / 1000).toFixed(1) + "s");
}

const all = fs.readdirSync(OUT).filter((f) => FILE_RE.test(f)).map((f) => f.replace(".json", ""))
  .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
fs.writeFileSync(path.join(OUT, "funnel.csv"), all.join(",") + "\n");
fs.writeFileSync(path.join(OUT, "report.csv"),
  "no,label,size,pairs,target_sec,measured_sec,player_sec,grind,gens,queued,spec,mut\n" +
  report.map((r) => [r.no, r.label, r.size, r.pairs, r.target.toFixed(1), r.sec.toFixed(1), r.player.toFixed(0),
    r.grind.toFixed(3), r.gens, r.queued, r.spec, r.mut].join(",")).join("\n") + "\n");

const byLabel = {};
for (const r of report) (byLabel[r.label] = byLabel[r.label] || []).push(r);
console.log("\n" + ((Date.now() - t0) / 1000).toFixed(0) + " sn — " + report.length + " level, generator'lı " +
  report.filter((r) => r.gens > 0).length);
for (const l of ["e", "m", "h", "vh"]) {
  const g = byLabel[l]; if (!g) continue;
  const miss = g.map((r) => r.sec - r.target);
  const rmse = Math.sqrt(miss.reduce((a, x) => a + x * x, 0) / g.length);
  const plateau = g.filter((r) => r.no >= RAMP_END);
  console.log("  " + l.padEnd(2) + " n " + String(g.length).padEnd(3) + " gen'li " + g.filter((r) => r.gens > 0).length +
    " RMSE " + rmse.toFixed(1) + " sn, en kötü " + Math.max(...miss.map(Math.abs)).toFixed(0) + " sn" +
    (plateau.length ? "; plato ort " + (plateau.reduce((a, r) => a + r.sec, 0) / plateau.length).toFixed(0) + " / hedef " + CURVE[l][1] : ""));
}
console.log("yazıldı: " + path.relative(ROOT, OUT) + "/ (" + all.length + " dosya) + funnel.csv + report.csv");
