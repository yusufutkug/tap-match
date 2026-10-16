"use strict";

// v4 funnel üretici — küçük boardlar, temiz açılış, kademeli generator:
//   node tools/gen_v4_levels.js            → export_levels_v4/<n>_<t|e|m|h|vh>.json
//   TM_N=60 node tools/gen_v4_levels.js    → yalnız 1-60
//   TM_KEEP=1                              → var olan dosyaları atla (devam)
//   TM_OUT=<klasör>                        → başka çıkış klasörü
// Deterministik (level no → seed). Önceki funnel klasörlerine ASLA yazmaz.
//
// Tasarım (tasarımcıyla kararlaştırıldı, Eki 2026):
//   boyut        8x12 YOK. Merdiven level numarasına bağlı: 5-6 5x7, 7-8
//                6x8, 9 tanıtım-1 (5x7), 10 5x7, 11 tanıtım-2 (6x8), 12-13
//                6x8, 14+ etikete göre: e 6x8/6x9, m 6x9/7x10, h/vh 7x10.
//                5x7 ilk 20 levelda 4 kez (5, 6, 9, 10), sonra yok.
//   hedef süre   tasarımcı sn: e 20 → 35, m 35 → 50, h 50 → 80, vh 70 → 110;
//                churn biçimli rampa 5 → 30. Süre YUMUŞAK öncelik: hizalı
//                taban ve temiz diziliş sert.
//   hizalı taban açılış boardunda iki taşı da görünen çiftlerin hizalı payı
//                collFloor(no) altına inemez: 5 → %60, 30 → %50, 60 → %40,
//                120 → %30, 200 → %20 (aralar doğrusal). Üstü serbest.
//   temiz açılış boşluk tek, dışbükey bir bölge (ortada dikdörtgen / kenar
//                çentiği / artı) — "boşluk çok olabilir ama parçalı olmasın".
//                Boş hücre bileşen sayısı ≤30'da sert (≤1 / ≤2), sonra
//                yumuşak ceza. Açılışta oynanabilir çift payı ≤20'de ≥ %25,
//                ≤30'da ≥ %20 (sert; tutmazsa kademeli gevşer, raporlanır).
//   generator    5-8 ve 10 saf. 9 = tanıtım-1 (şablon: 1 generator üst orta,
//                her basılan taş hemen eşleşir, arada 2 board çifti açılır).
//                11 = tanıtım-2 (şablon: 1 generator sol kenar, kuyruk 5,
//                near/mid karışık, son taş L eşleşmesi). 12-20 ≤ 2
//                generator, 21-30 ≤ 3, 31-60 ≤ 4, 61+ ≤ 5. ≤30'da doldurma
//                "pairs" zorunlu (çekim delikleri kapanır). Generator-only
//                akış yumuşak cezalı (spawn payı / ardışık seri).
//   mono slot    her onluğun (11+) ilk e levelı SAF ve 6x8 — tek renk
//                sticker levelı (tools/assign_stickers.js aynı kuralla seçer).
//
// Çıktı: dış format + TileGenerators (v3 ile aynı), funnel.csv, report.csv.
// Stickers: TM_OUT=export_levels_v4 node tools/assign_stickers.js &&
//           TM_OUT=export_levels_v4 node tools/check_stickers.js

const fs = require("fs");
const path = require("path");
const { isAdjacentCollinear, levelFromExternal, generatorIssues, GEN_DIR_CODES,
        boardFromLevel, matchablePairs } = require("../js/board.js");
const { effortCurve, spanOf, isCollinear, playTime } = require("../js/flow.js");
const { hashSeed, mulberry32, buildLevel, maskSyms, levelSyms, symHasAxisCell } = require("./v3_gen_lib.js");

const ROOT = path.join(__dirname, "..");
const OUT = path.resolve(ROOT, process.env.TM_OUT || "export_levels_v4");
const TUT_DIR = path.join(ROOT, "tutorial_levels");
const N = parseInt(process.env.TM_N || "200", 10);
const KEEP = !!process.env.TM_KEEP;

for (const guarded of ["export_levels", "export_levels_1010", "old_export_levels", "export_levels_v2",
                       "export_levels_v3", "export_levels_v3_old"]) {
  if (OUT === path.resolve(ROOT, guarded)) throw new Error("TM_OUT korunan klasöre işaret ediyor: " + guarded);
}

// ── funnel planı ──
const HEAD = "t t t t e e m e e e e m e h m e h m m vh".split(" ");
const LOOP = "m e h e vh m m h m vh".split(" ");
const labelOf = (no) => (no <= HEAD.length ? HEAD[no - 1] : LOOP[(no - HEAD.length - 1) % LOOP.length]);
const INTRO = { 9: 1, 10: 2 };                 // tanıtım levelları (ardışık: öğrendiğini hemen pekiştir)
const PURE_HEAD = new Set([5, 6, 7, 8]);       // generator yasak
// generator takvimi: tanıtımdan sonra mekanik KESİLMEZ — 11-13 zorunlu
// (1 → 1-2 → 2 generator), 14-30 arasında saf yalnız mono slotu; "lazım
// oldukça" (saf aday süreyi tutuyorsa generator koyma) yalnız 30+'da.
const GEN_MIN = { 11: 1, 12: 1, 13: 2 };
const GEN_MAX_OVERRIDE = {};
const genMin = (no) => GEN_MIN[no] || 0;
const genRequired = (no) => no <= 30 && !PURE_HEAD.has(no) && !INTRO[no];
// mono slot: 11+ her onluğun ilk e levelı (tanıtım / zorunlu generator
// levelları hariç) → saf, 6x8
const MONO = new Set();
{
  const seen = new Set();
  for (let no = 11; no <= Math.max(N, 20); no++) {
    const d = Math.floor((no - 1) / 10);
    if (labelOf(no) === "e" && !INTRO[no] && !GEN_MIN[no] && !seen.has(d)) { seen.add(d); MONO.add(no); }
  }
}
const isPure = (no) => PURE_HEAD.has(no) || MONO.has(no);

const CURVE = { e: [20, 35], m: [35, 50], h: [50, 80], vh: [70, 110] };
const RAMP_START = 5, RAMP_END = 30;
const ramp = (no) => {
  const t = Math.max(0, Math.min(1, (no - RAMP_START) / (RAMP_END - RAMP_START)));
  return 1 - (1 - t) * (1 - t);
};
const targetOf = (no, label) => { const [a, b] = CURVE[label]; return a + (b - a) * ramp(no); };

// boyut tavanları (tasarımcı sn; ortada boşluklu maske ile ölçüldü, Eki 2026):
// saf lo p10 / mid p50 / hi p90; generator'lı gMid (orta kalıp p50) / gHi
// (sert kalıp p90) / gMax
const SIZE_CAP = {
  "5x7":  { cols: 5, rows: 7,  lo: 8,  mid: 11, hi: 16, gMid: 14, gHi: 24, gMax: 29 },
  "6x8":  { cols: 6, rows: 8,  lo: 13, mid: 18, hi: 25, gMid: 25, gHi: 43, gMax: 54 },
  "6x9":  { cols: 6, rows: 9,  lo: 12, mid: 20, hi: 30, gMid: 31, gHi: 55, gMax: 74 },
  "7x10": { cols: 7, rows: 10, lo: 17, mid: 28, hi: 41, gMid: 46, gHi: 91, gMax: 119 },
};
// 10 (tanıtım-2) ve 12: tek generator ancak eksen hücresiyle simetrik olur
// → tek boyutlu 6x9 (orta satır); 6x8'de generator'lar hep çift sayıda.
const HEAD_SIZE = { 5: "5x7", 6: "5x7", 7: "6x8", 8: "6x8", 10: "6x9", 11: "6x8", 12: "6x9", 13: "6x8" };
function sizeOf(no, label, target) {
  if (HEAD_SIZE[no]) return HEAD_SIZE[no];
  if (MONO.has(no)) return "6x8";
  if (label === "e") return target <= 28 ? "6x8" : "6x9";
  if (label === "m") return no % 10 === 6 ? "6x9" : "7x10"; // çeşitlilik: her onlukta bir m 6x9
  return "7x10";
}

// ── üretim sabitleri ──
const CAND_PURE = 28, CAND_GEN = 28, REFINE_ROUNDS = 10;
const GRIND_W_PURE = 0.6, GRIND_OK_PURE = 0.15;
const GRIND_W_GEN = 0.4, GRIND_OK_GEN = 0.25;
const DONE_REL = 0.03, DIV_PEN = 0.04;
const mutBudget = (rows, cols) => Math.min(400, Math.max(120, 3 * rows * cols));

// hizalı taban
const COLL_FLOOR_PTS = [[5, 0.60], [30, 0.50], [60, 0.40], [120, 0.30], [200, 0.20]];
function collFloor(no) {
  const P = COLL_FLOOR_PTS;
  if (no <= P[0][0]) return P[0][1];
  for (let i = 1; i < P.length; i++) {
    if (no <= P[i][0]) { const [a, fa] = P[i - 1], [b, fb] = P[i]; return fa + (fb - fa) * (no - a) / (b - a); }
  }
  return P[P.length - 1][1];
}
const RESCUE_CP = [0.2, 0.1];

// temiz açılış: boş bileşen tavanı (sert ≤30, sonra yumuşak) ve açık çift
// tabanı. Generator'lı levelda çekimler kaçınılmaz delik bırakır (tidy
// çekimle blob'a komşu) → tavan 3; ayrıca her ek bileşen yumuşak cezalı.
const compsCap = (no, gens) => gens ? (no <= 20 ? 3 : no <= 30 ? 5 : Infinity) : no <= 20 ? 1 : no <= 30 ? 2 : Infinity;
const COMPS_W = 0.04; // yumuşak: 1 bileşen ötesi her bileşen
const openFloor = (no) => no <= 20 ? 0.25 : no <= 30 ? 0.20 : 0;
const OPEN_RELAX = [0, 0.05, 0.10, 0.15]; // tutmazsa kademeli gevşeme

// akış cezası (yumuşak; v3 ile aynı)
const FLOW_W = 0.2, FLOW_STREAK_OK = 6, FLOW_SHARE_OK = 0.6;
const genCap = (no) => GEN_MAX_OVERRIDE[no] || (no <= 20 ? 2 : no <= 30 ? 3 : no <= 60 ? 4 : 5);

// ── açılış boşluğu: tek dışbükey bölge ──
// Şekil: center (ortada dikdörtgen) · top / bottom (kenar çentiği, ortalı) ·
// plus (artı). Boşluk payı level ilerledikçe ve etiket sertleştikçe küçülür
// (süre için çift lazım); erken levellarda büyük boşluk = çok açık çift
// (ölçüm: 5x7 3x3 delik açık %31, 1x3 delik %13). Kalan alan çift (parite
// onarımı tetiklenmez). Dönüş: seed'e göre karışık maske listesi (üretim
// kısıt tutmazsa sıradaki maskeyi dener).
function holeFrac(no, label) {
  if (no <= 20) return label === "h" || label === "vh" ? [0.10, 0.18] : [0.18, 0.34];
  if (no <= 30) return label === "vh" ? [0.03, 0.08] : label === "h" ? [0.06, 0.14] : [0.10, 0.25];
  return label === "vh" ? [0.03, 0.08] : label === "h" ? [0.03, 0.10] : [0.04, 0.16];
}
function holeMasks(rows, cols, no, label) {
  const rng = mulberry32(hashSeed("v4-hole:" + no));
  const area = rows * cols;
  const [fLo, fHi] = holeFrac(no, label);
  const minCells = Math.max(2, Math.floor(area * fLo));
  const maxCells = Math.max(minCells + 1, Math.floor(area * fHi));
  const shapes = [];
  // simetri: dikdörtgen yatayda tam ortalanabilmeli ((cols-hc) çift) → V
  // aynası; artı yalnız iki boyut da tekse ortalanır
  for (let hr = 1; hr <= rows - 2; hr++) for (let hc = 1; hc <= cols - 2; hc++) {
    const n = hr * hc;
    if (n < minCells || n > maxCells || (area - n) % 2 || (cols - hc) % 2) continue;
    if (hr > 1 && hc > 1 && hr * 2 < hc) continue; // çok yatık şerit değil
    shapes.push({ kind: "center", hr, hc });
    if (hr >= 2 || hc >= 3) { shapes.push({ kind: "top", hr, hc }); shapes.push({ kind: "bottom", hr, hc }); }
  }
  for (let a = 1; a <= 2; a++) { // artı: kol uzunluğu a → 4a+1 hücre
    const n = 4 * a + 1;
    if (n >= minCells && n <= maxCells && (area - n) % 2 === 0 && 2 * a + 1 <= cols - 2 && 2 * a + 1 <= rows - 2 &&
        cols % 2 === 1 && rows % 2 === 1)
      shapes.push({ kind: "plus", a });
  }
  if (!shapes.length) {
    const hc = cols % 2 === 0 ? 2 : 1;
    shapes.push({ kind: "center", hr: (area - hc) % 2 === 0 ? 1 : 2, hc });
  }
  const order = shapes.map((s, i) => [s, rng() + i * 1e-9]).sort((a, b) => a[1] - b[1]).map((x) => x[0]).slice(0, 5);
  return order.map((s) => {
    const mask = Array.from({ length: rows }, () => Array(cols).fill(true));
    if (s.kind === "plus") {
      const r = (rows - 1) / 2, c = (cols - 1) / 2;
      for (let k = -s.a; k <= s.a; k++) { mask[r][c + k] = false; mask[r + k][c] = false; }
      return mask;
    }
    const c0 = Math.floor((cols - s.hc) / 2);
    const r0 = s.kind === "center" ? Math.floor((rows - s.hr) / 2) : s.kind === "top" ? 0 : rows - s.hr;
    for (let r = r0; r < r0 + s.hr; r++) for (let c = c0; c < c0 + s.hc; c++) mask[r][c] = false;
    return mask;
  });
}

// v2 reçete paleti (saf board); cornerP paleti hizalı tabana göre kayar
function recipeOf(cap, target, cand, floor, cpOverride) {
  const h = Math.max(0, Math.min(1, (target - cap.lo) / (cap.hi - cap.lo)));
  const knotPool = h < 0.35 ? [0, 2, 3, 4] : h < 0.6 ? [3, 4, 6, 8] : [6, 8, 10, 14];
  const sbPool = h < 0.6 ? [0.3, 0.6, 0.9] : [0.3, 0.3, 0.6, 0.9];
  const cl = (x) => Math.max(0.15, Math.min(1, x));
  const cpPool = cpOverride !== undefined ? [cpOverride]
    : [cl(1 - floor - 0.2), cl(1 - floor - 0.05), cl(1 - floor + 0.1)];
  const fmPool = ["bolge", "yilan", "cepheler"];
  const cutPool = [null, "dikey", "yatay", null];
  return {
    knots: knotPool[cand % knotPool.length],
    spanBias: sbPool[Math.floor(cand / 4) % sbPool.length],
    cornerP: cpPool[Math.floor(cand / 12) % cpPool.length],
    frontMode: fmPool[Math.floor(cand / 3) % fmPool.length],
    cut: cutPool[Math.floor(cand / 2) % cutPool.length],
    entryN: 1 + (cand % 3 === 0 ? 2 : cand % 2), // 1 / 2 / 3 giriş (açık çift tabanı için)
    frontBias: cand % 5 === 4 ? 0.85 : 1.0,
  };
}

// Kalıp havuzu (v3); erken levellarda doldurma "pairs" zorunlu
const PLACEMENTS = ["edge", "corner", "inner", "mixed", "facing"];
function specOf(cap, target, cand, rng, gMax, early, gMin = 1, symOpts = null, rows = cap.rows, cols = cap.cols) {
  const hg = Math.max(0, Math.min(1.2, (target - cap.mid) / (cap.gHi - cap.mid)));
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const genN = Math.max(gMin, Math.min(gMax, hg < 0.3 ? pick([1, 2, 2]) : hg < 0.6 ? pick([2, 3, 3]) : hg < 0.9 ? pick([3, 4, 4, 5]) : pick([4, 5, 6])));
  const queueLen = hg < 0.3 ? pick([2, 3, 4]) : hg < 0.6 ? pick([4, 6, 8]) : pick([6, 8, 12]);
  const pk = hg < 0.3 ? pick(["near", "near", "mid", "alt"])
    : hg < 0.6 ? pick(["near", "mid", "alt", "random", "far"])
    : pick(["mid", "far", "far", "alt", "random"]);
  // erken: doldurma yok (doldurma boşluğu böler; ölçüm: none ile bileşen
  // ≤2 payı 6x8'de 15/24, pairs ile 6/24). tidy: çekimler blob'a komşu.
  const refill = early ? "none"
    : hg < 0.3 ? pick(["none", "none", "pairs"])
    : hg < 0.6 ? pick(["none", "pairs", "pairs", "singles"])
    : pick(["pairs", "pairs", "singles", "none"]);
  let placement = PLACEMENTS[(cand + Math.floor(rng() * 2)) % PLACEMENTS.length];
  if (placement === "facing" && gMax < 2) placement = "edge";
  const syncN = genN >= 2 ? (hg < 0.5 ? pick([0, 0, 1]) : pick([0, 1, 2])) : 0;
  const s = { placement, genN: placement === "facing" ? Math.max(2, Math.min(gMax, genN)) : genN, queueLen, pick: pk,
              refill, refillFrac: early ? 1 : pick([0.5, 1]), syncN, queueMax: queueLen + (hg > 0.8 ? 8 : 4), tidy: true, keepColl: true };
  return symFix(s, symOpts, rows, cols, rng, gMin, gMax);
}
// Simetri: maskenin sağladığı eksenlerden biri (V öncelikli — sol/sağ
// aynası en okunaklı). Karşılıklı yerleşim V/H ister. Tek sayıda generator
// yalnız eksen hücresi olan eksende; yoksa eksen değiştir ya da sayıyı
// çifte yuvarla.
function symFix(s, symOpts, rows, cols, rng, gMin, gMax) {
  if (!symOpts || !symOpts.length) { s.sym = null; return s; }
  let opts = symOpts.slice();
  if (s.placement === "facing") {
    opts = opts.filter((x) => x !== "P" || rows % 2 === 1 || cols % 2 === 1);
    if (!opts.length) { s.placement = "edge"; opts = symOpts.slice(); }
  }
  const weighted = opts.flatMap((x) => (x === "V" ? [x, x, x] : x === "H" ? [x, x] : [x]));
  s.sym = weighted[Math.floor(rng() * weighted.length)];
  if (s.genN % 2 === 1 && !symHasAxisCell(s.sym, rows, cols)) {
    const alt = opts.find((x) => symHasAxisCell(x, rows, cols));
    if (alt && s.placement !== "facing") s.sym = alt;
    else if (s.genN + 1 <= gMax) s.genN += 1;
    else if (s.genN - 1 >= Math.max(1, gMin, s.placement === "facing" ? 2 : 1)) s.genN -= 1;
    else return null; // simetrik yerleşim mümkün değil
  }
  return s;
}
const specSig = (s) => s ? s.placement + "|" + s.genN + "|" + s.pick + "|" + s.refill : "pure";
function varySpec(spec, below, rng, gMax, early, gMin = 1, symOpts, rows, cols) {
  const s = { ...spec };
  const r = rng();
  if (r < 0.3) s.queueLen = Math.max(1, s.queueLen + (below ? 2 : -2));
  else if (r < 0.5) s.genN = Math.max(gMin, s.placement === "facing" ? 2 : 1, Math.min(gMax, s.genN + (below ? 1 : -1)));
  else if (r < 0.7 && !early) s.refill = below ? (s.refill === "none" ? "pairs" : "singles") : (s.refill === "singles" ? "pairs" : "none");
  else if (r < 0.85) s.pick = below ? (s.pick === "near" ? "mid" : "far") : (s.pick === "far" ? "mid" : "near");
  else s.placement = PLACEMENTS[Math.floor(rng() * PLACEMENTS.length)];
  if (s.placement === "facing" && gMax < 2) s.placement = "edge";
  if (s.placement === "facing") s.genN = Math.max(2, Math.min(gMax, s.genN));
  s.queueMax = s.queueLen + 4;
  return symFix(s, symOpts, rows, cols, rng, gMin, gMax);
}

// ── ölçüm / skor ──
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
function boardCollShare(pairs) {
  let n = 0, coll = 0;
  for (const p of pairs) if (p.length === 2) { n++; if (isCollinear(p)) coll++; }
  return n ? coll / n : 0;
}
function flowStats(ecS, gens) {
  if (!gens || !gens.length) return { spawnShare: 0, maxStreak: 0 };
  const queued = new Set();
  for (const g of gens) for (const pid of g.queue) queued.add(pid);
  let n = 0, best = 0, cur = 0;
  for (const mv of ecS.moves) {
    if (mv.pairIds.every((pid) => queued.has(pid))) { n++; cur++; if (cur > best) best = cur; }
    else cur = 0;
  }
  return { spawnShare: n / Math.max(1, ecS.moves.length), maxStreak: best };
}
// açılış: boş hücre bileşenleri (generator hücresi boş sayılmaz) ve
// oynanabilir çift payı (board + generator duvarlarıyla)
function openingStats(lv, rows, cols) {
  const board = boardFromLevel({ rows, cols, pairs: lv.pairs, generators: lv.generators || [] });
  const seen = Array.from({ length: rows }, () => Array(cols).fill(false));
  let comps = 0, empties = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (board[r][c] !== null || seen[r][c]) continue;
    comps++;
    const st = [[r, c]]; seen[r][c] = true;
    while (st.length) {
      const [a, b] = st.pop(); empties++;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const rr = a + dr, cc = b + dc;
        if (rr < 0 || rr >= rows || cc < 0 || cc >= cols || seen[rr][cc] || board[rr][cc] !== null) continue;
        seen[rr][cc] = true; st.push([rr, cc]);
      }
    }
  }
  const onBoard = lv.pairs.filter((p) => p.length === 2).length;
  const open = matchablePairs(board).size;
  return { comps, empties, openShare: onBoard ? open / onBoard : 0 };
}
function measure(lv, rows, cols, target, recentSigs, spec, no) {
  const gens = lv.generators || null;
  const ecS = effortCurve(lv.pairs, rows, cols, null, "sweep", gens);
  if (!ecS) return null;
  const sec = ecS.effortMean * lv.pairs.length / 10;
  const grind = grindShare(ecS, ecS.pairs, rows, cols, gens);
  const gw = gens ? GRIND_W_GEN : GRIND_W_PURE;
  const div = recentSigs.includes(specSig(spec)) ? DIV_PEN : 0;
  const relErr = Math.abs(sec - target) / target;
  const coll = boardCollShare(lv.pairs);
  const { spawnShare, maxStreak } = flowStats(ecS, gens);
  const flowPen = FLOW_W * (Math.max(0, maxStreak - FLOW_STREAK_OK) / FLOW_STREAK_OK +
                            Math.max(0, spawnShare - FLOW_SHARE_OK) / 0.25);
  const op = openingStats(lv, rows, cols);
  const compsPen = COMPS_W * Math.max(0, op.comps - 1);
  const syms = levelSyms(lv, rows, cols).join("");
  return { sec, grind, ecS, relErr, coll, spawnShare, maxStreak, flowPen, comps: op.comps, openShare: op.openShare,
           empties: op.empties, hasGens: !!(gens && gens.length), syms, key: relErr + gw * grind + div + flowPen + compsPen };
}
const isDone = (m, gens) => m.relErr <= DONE_REL && m.grind <= (gens ? GRIND_OK_GEN : GRIND_OK_PURE) && m.flowPen === 0;
// sert kısıtlar: hizalı taban, boş bileşen tavanı, açık çift tabanı (relax
// ile), silüet simetrisi (needSym; tutmazsa son çare gevşer → not "asim")
const hardOk = (m, floor, no, relax, needSym = true) =>
  m.coll >= floor - 1e-9 && m.comps <= compsCap(no, m.hasGens) && m.openShare >= openFloor(no) - relax - 1e-9 &&
  (!needSym || m.syms.length > 0);

// ── çift mutasyonu (v3) ──
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
function mutate(cur, rows, cols, target, recentSigs, rng, floor, no, relax) {
  let accepted = 0;
  const budget = mutBudget(rows, cols);
  for (let e = 0; e < budget && !isDone(cur.m, cur.lv.generators); e++) {
    const next = mutateOnce(cur.lv, rows, cols, rng, guidePairs(cur.m.ecS, cur.m.sec < target));
    if (!next) continue;
    const nm = measure(next, rows, cols, target, recentSigs, cur.spec, no);
    if (!nm || !hardOk(nm, floor, no, relax) || nm.key >= cur.m.key - 1e-9) continue;
    if (next.generators && generatorIssues({ rows, cols, pairs: next.pairs, generators: next.generators }).length) continue;
    cur = { ...cur, lv: next, m: nm };
    accepted++;
  }
  return { ...cur, accepted };
}

// ── tanıtım şablonları (iç koordinat: r 0 üst, c 0 sol) ──
// Tanıtım-1 (5x7): generator üst orta, aşağı bakar. Tıpa A'nın eşi hemen
// yanında; kuyruktaki 4 taşın (B D F H) eşi basıldığı an görünür hizalı.
// Arada C ve E board çiftleri açılır (D/F kalkınca), J generator kırılınca.
function introLevel1() {
  const P = {};
  const add = (k, ...cells) => { P[k] = cells; };
  add("A", [1, 0], [1, 2]); add("B", [1, 4]); add("J", [0, 0], [0, 4]);
  add("K", [2, 0], [4, 0]); add("L", [2, 4], [4, 4]);
  add("C", [3, 0], [3, 4]); add("D", [3, 2]);
  add("E", [5, 0], [5, 4]); add("F", [5, 2]);
  add("M", [6, 0], [6, 4]); add("H", [6, 2]);
  const order = ["A", "B", "J", "K", "L", "C", "D", "E", "F", "M", "H"];
  const id = Object.fromEntries(order.map((k, i) => [k, i]));
  return { rows: 7, cols: 5, pairs: order.map((k) => P[k]),
           generators: [{ r: 0, c: 2, dir: "D", queue: ["B", "D", "F", "H"].map((k) => id[k]) }] };
}
// Tanıtım-2 (level 11, 6x8) şablon değil üretimdir: dolu temiz board +
// 1 generator, kuyruk 5, near/mid dönüşümlü — tanıtım-1'de öğrenilen
// mekaniğin gerçek boardda pratiği (ana döngüde introGen).

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
function verifyExt(ext) {
  const lv = levelFromExternal(ext);
  const issues = generatorIssues(lv);
  if (issues.length) return "yerleşim: " + issues[0];
  if (!effortCurve(lv.pairs, lv.rows, lv.cols, null, "sweep", lv.generators)) return "tıkalı";
  const cnt = lv.pairs.map((p) => p.length);
  for (const g of lv.generators || []) for (const pid of g.queue) cnt[pid]++;
  if (cnt.some((n) => n !== 2)) return "çift sayımı bozuk";
  for (const p of lv.pairs) if (p.length === 2 && isAdjacentCollinear(p)) return "bitişik hizalı çift";
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
const row = (no, label, sizeKey, lv, m, pt, spec, mut, extra) => ({
  no, label, size: sizeKey, pairs: lv.pairs.length, target: extra.target, sec: m ? m.sec : NaN,
  player: pt ? pt.playerSeconds : NaN, grind: m ? m.grind : NaN, gens: (lv.generators || []).length,
  queued: (lv.generators || []).reduce((a, g) => a + g.queue.length, 0), spec: specSig(spec), mut,
  floor: extra.floor, coll: m ? m.coll : NaN, spawn: m ? m.spawnShare : NaN, streak: m ? m.maxStreak : NaN,
  comps: m ? m.comps : NaN, open: m ? m.openShare : NaN, empties: m ? m.empties : NaN, sym: m ? (m.syms || "-") : "-",
  note: extra.note || "",
});
const logRow = (r, tl) => console.log(
  String(r.no).padStart(3) + " " + r.label.padEnd(2) + " " + r.size.padEnd(5) + " çift " + String(r.pairs).padEnd(3) +
  " hedef " + r.target.toFixed(0).padStart(3) + " ölçülen " + r.sec.toFixed(0).padStart(3) +
  " öğütme %" + String(Math.round(100 * r.grind)).padStart(2) +
  " hizalı %" + String(Math.round(100 * r.coll)).padStart(2) + "/" + Math.round(100 * r.floor) +
  " açık %" + String(Math.round(100 * r.open)).padStart(2) + " boş " + String(r.empties).padEnd(2) + "/" + r.comps +
  " spawn %" + String(Math.round(100 * r.spawn)).padStart(2) + " seri " + String(r.streak).padEnd(2) +
  " sim " + (r.sym || "-").padEnd(3) +
  " oyuncu~" + r.player.toFixed(0) + " gen " + r.gens + " kuyruk " + String(r.queued).padEnd(3) + r.spec.padEnd(24) +
  " mut " + String(r.mut).padEnd(3) + (r.note ? " [" + r.note + "] " : "") + ((Date.now() - tl) / 1000).toFixed(1) + "s");

for (let no = 5; no <= N; no++) {
  const label = labelOf(no);
  let target = targetOf(no, label);
  const floor = collFloor(no);
  const tl = Date.now();
  if (KEEP && existing.has(no)) {
    const ext = JSON.parse(fs.readFileSync(path.join(OUT, existing.get(no)), "utf8"));
    const lv = levelFromExternal(ext);
    const m = measure(lv, lv.rows, lv.cols, target, [], null, no);
    const pt = playTime(lv.pairs, lv.rows, lv.cols, "player", lv.generators);
    report.push(row(no, label, ext.width + "x" + ext.height, lv, m, pt, null, 0, { target, floor, note: "keep" }));
    continue;
  }
  // tanıtım-1: şablon (tanıtım-2 üretimle: aşağıda introGen)
  if (INTRO[no] === 1) {
    const t = introLevel1();
    const ext = extOf(t, t.rows, t.cols);
    const bad = verifyExt(ext);
    if (bad) throw new Error("tanıtım " + no + " doğrulama: " + bad);
    const m = measure(t, t.rows, t.cols, target, [], null, no);
    const pt = playTime(t.pairs, t.rows, t.cols, "player", t.generators);
    writeExt(no, label, ext, null);
    const r = row(no, label, t.cols + "x" + t.rows, t, m, pt, { placement: "intro", genN: 1, pick: "near", refill: "none" }, 0,
                  { target, floor, note: "tanıtım-" + INTRO[no] });
    report.push(r); logRow(r, tl);
    continue;
  }
  const sizeKey = sizeOf(no, label, target);
  const cap = SIZE_CAP[sizeKey];
  const { rows, cols } = cap;
  // mono slot "kesin kolay": hedef saf 6x8'in rahat bölgesine kırpılır
  // (öğütmeyle süre şişirilmesin)
  if (MONO.has(no)) target = Math.min(target, (cap.mid + cap.hi) / 2);
  let masks = holeMasks(rows, cols, no, label);
  // tanıtım-2: tek generator eksen hücresinde → maske o eksende simetrik olmalı
  if (INTRO[no] === 2) {
    const ax = masks.filter((mk) => maskSyms(mk, rows, cols).some((s) => symHasAxisCell(s, rows, cols)));
    if (ax.length) masks = ax;
  }
  let mask = masks[0];
  const recentSigs = recentByLabel[label].slice(-3);
  const rngL = mulberry32(hashSeed("v4:" + no));
  const pure = isPure(no);
  const early = no <= 30;
  const gMax = genCap(no);
  const gMin = Math.max(1, genMin(no));
  const needGen = !pure && genRequired(no); // saf aday havuza girmez
  // tanıtım-2: dolu temiz boardda 1 generator, kuyruk 5, near/mid dönüşümlü
  // ("alt"), doldurma yok; saf aday yarışmaz
  const introGen = INTRO[no] === 2;
  let note = pure ? (MONO.has(no) ? "mono" : "saf") : introGen ? "tanıtım-2" : "";
  let relax = 0;

  // Aşama A: adaylar maske başına BİR kez kurulur (saf + generator'lı),
  // kısıt gevşemesi (açık taban) kurulan havuz üzerinde seçilir; yeniden
  // kurulum yalnız hizalı tabanı kimse tutmazsa (cp kurtarması).
  const all = []; // { lv, m, rec, spec, cand, mi }
  const build = (cand, cpOverride, mi, withGen) => {
    const mk = masks[mi];
    if (!introGen && !needGen) {
      const rec = recipeOf(cap, target, cand, floor, cpOverride);
      const lv = buildLevel(rows, cols, rec, null, hashSeed("v4p:" + no + ":" + cand), mk);
      if (lv) { const m = measure(lv, rows, cols, target, recentSigs, null, no); if (m) all.push({ lv, m, rec, spec: null, cand, mi }); }
    }
    if (!withGen) return;
    // tanıtım-2 reçetesi yumuşak: az düğüm, geniş span, düşük köşe payı
    // (sert palet hizalı payını düşürür, kuyruk 5'e ulaşamaz)
    const recG = introGen
      ? { knots: [0, 2, 3][cand % 3], spanBias: [0.6, 0.9][cand % 2], cornerP: [0.2, 0.3, 0.35][Math.floor(cand / 3) % 3],
          frontMode: ["bolge", "yilan", "cepheler"][Math.floor(cand / 2) % 3], cut: null, entryN: 2 + (cand % 2), frontBias: 1 }
      : recipeOf(cap, Math.min(target, cap.hi), cand, floor, cpOverride);
    // tanıtım-2: kenar ortasında tek generator (eksen hücresi → H aynası)
    const symOpts = maskSyms(mk, rows, cols);
    const spec = introGen
      ? { placement: "edge", genN: 1, queueLen: 5, pick: cand % 3 === 2 ? "near" : "alt",
          refill: "none", refillFrac: 1, syncN: 0, queueMax: 5, tidy: true, keepColl: true,
          sym: symOpts.find((x) => symHasAxisCell(x, rows, cols)) || null }
      : specOf(cap, target, cand, rngL, gMax, early, gMin, symOpts, rows, cols);
    if (!spec) return;
    const lg = buildLevel(rows, cols, recG, spec, hashSeed("v4g:" + no + ":" + cand), mk);
    if (lg) { const m = measure(lg, rows, cols, target, recentSigs, spec, no); if (m) all.push({ lv: lg, m, rec: recG, spec, cand, mi }); }
  };
  const nMasks = early ? Math.min(3, masks.length) : 1;
  const nCand = introGen ? 48 : early ? 20 : CAND_PURE;
  for (let mi = 0; mi < nMasks; mi++) for (let cand = 0; cand < nCand; cand++) build(cand, undefined, mi, !pure);
  // kısıt seçimi: en küçük gevşemeyle geçen adaylar (önce simetrik; simetri
  // tutmazsa asimetrik — not "asim")
  let needSym = true;
  const passing = (rx) => all.filter((x) => hardOk(x.m, floor, no, rx, needSym));
  let pool = [];
  const selectPool = () => {
    for (const ns of [true, false]) {
      needSym = ns;
      for (let ri = 0; ri < OPEN_RELAX.length && !pool.length; ri++) { relax = OPEN_RELAX[ri]; pool = passing(relax); }
      if (pool.length) return;
    }
  };
  selectPool();
  // cp kurtarması: hizalı taban (ya da bileşen) kimsede tutmadı
  for (let ri = 0; ri < RESCUE_CP.length && !pool.length; ri++) {
    note += (note ? "," : "") + "cp" + RESCUE_CP[ri];
    for (let mi = 0; mi < nMasks; mi++) for (let cand = 0; cand < nCand; cand++) build(100 * (ri + 1) + cand, RESCUE_CP[ri], mi, !pure);
    selectPool();
  }
  if (pool.length && relax) note += (note ? "," : "") + "açık-" + Math.round(100 * relax);
  if (pool.length && !needSym) note += (note ? "," : "") + "asim";
  if (!pool.length) throw new Error("kısıtları tutan aday bulunamadı: level " + no + " (hizalı " + floor.toFixed(2) + ", açık " + openFloor(no) + ")");
  // "lazım oldukça": saf aday hedefe yakınsa mutasyonla itilir; tutarsa
  // generator gerekmez. Saf-yalnız levelda saf en iyi her hâlükârda alınır.
  const pures = pool.filter((x) => !x.spec).sort((a, b) => a.m.relErr - b.m.relErr || a.m.key - b.m.key);
  let pureBest = pures[0] || null;
  if (pureBest) mask = masks[pureBest.mi];
  if (pureBest && !isDone(pureBest.m, null) && (pure || pureBest.m.relErr <= 0.08)) {
    const pm = mutate(pureBest, rows, cols, target, recentSigs, mulberry32(hashSeed("v4-pmut:" + no)), floor, no, relax);
    if (pure || isDone(pm.m, null)) pureBest = { ...pm, mi: pureBest.mi };
  }
  let best;
  const queuedOf = (x) => (x.lv.generators || []).reduce((a, g) => a + g.queue.length, 0);
  if (pure || (pureBest && isDone(pureBest.m, null))) best = pureBest;
  else if (introGen) { pool.sort((a, b) => queuedOf(b) - queuedOf(a) || a.m.key - b.m.key); best = pool[0]; } // kuyruk dolu olsun (5 basım)
  else { pool.sort((a, b) => a.m.key - b.m.key || a.cand - b.cand); best = pool[0]; }
  if (!best) best = pool.sort((a, b) => a.m.key - b.m.key)[0];
  mask = masks[best.mi];
  if (best.spec && !introGen && !isDone(best.m, best.lv.generators)) {
    for (let r = 0; r < REFINE_ROUNDS && !isDone(best.m, best.lv.generators); r++) {
      const spec = varySpec(best.spec, best.m.sec < target, rngL, gMax, early, gMin, maskSyms(mask, rows, cols), rows, cols);
      if (!spec) continue;
      const rec = recipeOf(cap, Math.min(target, cap.hi), best.cand + r + 1, floor, best.rec.cornerP);
      const lv = buildLevel(rows, cols, rec, spec, hashSeed("v4r:" + no + ":" + r), mask);
      if (!lv) continue;
      const m = measure(lv, rows, cols, target, recentSigs, spec, no);
      if (!m || !hardOk(m, floor, no, relax, needSym) || m.key >= best.m.key) continue;
      best = { lv, m, rec, spec, cand: best.cand };
    }
  }
  const ref = mutate(best, rows, cols, target, recentSigs, mulberry32(hashSeed("v4-mut:" + no)), floor, no, relax);
  const lv = ref.lv;
  const gens = lv.generators || [];
  const ext = extOf(lv, rows, cols);
  const bad = verifyExt(ext);
  if (bad) throw new Error("doğrulama: level " + no + " — " + bad);
  const onBoard = lv.pairs.reduce((a, p) => a + p.length, 0);
  const queued = gens.reduce((a, g) => a + g.queue.length, 0);
  if (onBoard + queued !== 2 * lv.pairs.length) throw new Error("taş sayımı bozuk: level " + no);
  const pt = playTime(lv.pairs, rows, cols, "player", gens.length ? gens : undefined);
  recentByLabel[label].push(specSig(ref.spec));
  writeExt(no, label, ext, null);
  const r = row(no, label, sizeKey, lv, ref.m, pt, ref.spec, ref.accepted, { target, floor, note });
  report.push(r); logRow(r, tl);
}

const all = fs.readdirSync(OUT).filter((f) => FILE_RE.test(f)).map((f) => f.replace(".json", ""))
  .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
fs.writeFileSync(path.join(OUT, "funnel.csv"), all.join(",") + "\n");
fs.writeFileSync(path.join(OUT, "report.csv"),
  "no,label,size,pairs,target_sec,measured_sec,player_sec,grind,gens,queued,spec,mut,coll_floor,coll_share,spawn_share,max_streak,empty_comps,open_share,empties,sym,note\n" +
  report.map((r) => [r.no, r.label, r.size, r.pairs, r.target.toFixed(1), r.sec.toFixed(1), r.player.toFixed(0),
    r.grind.toFixed(3), r.gens, r.queued, r.spec, r.mut, r.floor.toFixed(3), r.coll.toFixed(3), r.spawn.toFixed(3),
    r.streak, r.comps, r.open.toFixed(3), r.empties, r.sym, r.note].join(",")).join("\n") + "\n");

const byLabel = {};
for (const r of report) (byLabel[r.label] = byLabel[r.label] || []).push(r);
console.log("\n" + ((Date.now() - t0) / 1000).toFixed(0) + " sn — " + report.length + " level, generator'lı " +
  report.filter((r) => r.gens > 0).length + ", boyutlar: " +
  Object.entries(report.reduce((a, r) => (a[r.size] = (a[r.size] || 0) + 1, a), {})).map(([k, v]) => k + "×" + v).join(" "));
for (const l of ["e", "m", "h", "vh"]) {
  const g = byLabel[l]; if (!g) continue;
  const miss = g.map((r) => r.sec - r.target);
  const rmse = Math.sqrt(miss.reduce((a, x) => a + x * x, 0) / g.length);
  const plateau = g.filter((r) => r.no >= RAMP_END);
  console.log("  " + l.padEnd(2) + " n " + String(g.length).padEnd(3) + " gen'li " + g.filter((r) => r.gens > 0).length +
    " RMSE " + rmse.toFixed(1) + " sn, en kötü " + Math.max(...miss.map(Math.abs)).toFixed(0) + " sn" +
    (plateau.length ? "; plato ort " + (plateau.reduce((a, r) => a + r.sec, 0) / plateau.length).toFixed(0) + " / hedef " + CURVE[l][1] : ""));
}
const genR = report.filter((r) => r.gens > 0);
console.log("  hizalı taban ihlali " + report.filter((r) => r.coll < r.floor - 1e-9).length +
  "; açık taban gevşetilen " + report.filter((r) => /açık-/.test(r.note)).length +
  "; kurtarma " + report.filter((r) => /cp0/.test(r.note)).length +
  "; asimetrik " + report.filter((r) => r.sym === "-" || r.sym === "").length +
  "; ≤30 boş bileşen>tavan " + report.filter((r) => r.no <= 30 && r.comps > compsCap(r.no, r.gens > 0)).length +
  "; generator'lı: spawn >%60 " + genR.filter((r) => r.spawn > FLOW_SHARE_OK).length +
  ", seri >" + FLOW_STREAK_OK + " " + genR.filter((r) => r.streak > FLOW_STREAK_OK).length + " / " + genR.length);
console.log("yazıldı: " + path.relative(ROOT, OUT) + "/ (" + all.length + " dosya) + funnel.csv + report.csv");
