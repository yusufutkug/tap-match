"use strict";

// Üretici duman testi + istatistik. Çalıştırma: node tools/test_generator.js

const { isAdjacentCollinear } = require("../js/board.js");
const { analyzeFlow, pairsCurve } = require("../js/flow.js");
const { generateLevel, generateCandidates, generateFullLevel } = require("../js/generator.js");
const { TM_SHAPES } = require("../js/shapes.js");

let nOk = 0, nFail = 0;
function check(name, cond) {
  if (cond) { nOk++; }
  else { nFail++; console.error("FAIL: " + name); }
}

function validate(name, lv, opts) {
  check(name + ": üretildi", !!lv);
  if (!lv) return;
  check(name + ": bitişik hizalı çift yok", !lv.pairs.some(isAdjacentCollinear));
  const cv = pairsCurve(lv.pairs, lv.rows, lv.cols);
  check(name + ": çözülebilir", cv !== null);
  const flow = analyzeFlow(lv.pairs, lv.rows, lv.cols);
  check(name + ": deadlock yok", flow.deadlocked.length === 0);
  check(name + ": dalga-0 = tasarım (" + lv.entries + ")", flow.entries === lv.entries);
  check(name + ": derinlik >= " + opts.depthMin, flow.depth >= opts.depthMin);
  // hücreler benzersiz
  const cells = new Set();
  let overlap = false;
  for (const p of lv.pairs) for (const [r, c] of p) {
    const k = r + "," + c;
    if (cells.has(k)) overlap = true;
    cells.add(k);
  }
  check(name + ": hücreler benzersiz", !overlap);
}

// Determinizm: aynı seed aynı level
{
  const o = { rows: 7, cols: 7, entryN: 3, lockedN: 1, depthMin: 3, depthMax: 4, seed: 42 };
  const a = generateLevel(o), b = generateLevel(o);
  check("determinizm", !!a && JSON.stringify(a.pairs) === JSON.stringify(b.pairs));
}

// Konfigürasyon taraması
const configs = [
  { name: "7x7 hafif", rows: 7, cols: 7, entryN: 3, lockedN: 1, depthMin: 3, depthMax: 4 },
  { name: "8x8 orta", rows: 8, cols: 8, entryN: 4, lockedN: 2, depthMin: 3, depthMax: 5 },
  { name: "9x9 derin", rows: 9, cols: 9, entryN: 4, lockedN: 2, depthMin: 4, depthMax: 6 },
  { name: "10x10 geniş", rows: 10, cols: 10, entryN: 5, lockedN: 3, depthMin: 4, depthMax: 6 },
  { name: "10x15 dev", rows: 15, cols: 10, entryN: 6, lockedN: 5, depthMin: 5, depthMax: 7, cornerP: 0.75 },
  { name: "12x18 çift kapı", rows: 18, cols: 12, entryN: 7, lockedN: 8, depthMin: 5, depthMax: 8, gateN: 2, cornerP: 0.75 },
];

console.log("konfig       ok/N   dnm    çift  fill  depth  dip    waist@  effPk  köşe%  giriş");
for (const cfg of configs) {
  const res = generateCandidates({ ...cfg, seed: 1234, samples: 8, maxAttempts: 300 });
  const cands = res.candidates;
  check(cfg.name + ": en az yarısı üretildi", cands.length >= 4);
  for (const lv of cands.slice(0, 2)) validate(cfg.name, lv, cfg);
  if (!cands.length) continue;
  const avg = (f) => cands.reduce((a, lv) => a + f(lv), 0) / cands.length;
  const avgAtt = avg((lv) => lv.attempts);
  console.log(
    cfg.name.padEnd(13) +
    (cands.length + "/8").padEnd(7) +
    avgAtt.toFixed(0).padEnd(7) +
    avg((lv) => lv.pairs.length).toFixed(1).padEnd(6) +
    avg((lv) => lv.fill).toFixed(2).padEnd(6) +
    avg((lv) => lv.flow.depth).toFixed(1).padEnd(7) +
    avg((lv) => lv.curve.dip).toFixed(2).padEnd(7) +
    avg((lv) => lv.curve.waistPos).toFixed(2).padEnd(8) +
    avg((lv) => lv.curve.effortPeak).toFixed(1).padEnd(7) +
    (avg((lv) => lv.curve.cornerShare) * 100).toFixed(0).padEnd(7) +
    avg((lv) => lv.flow.entries).toFixed(1)
  );
}

// ── Tam dolu üretim (ileri soyma, js/generator.js generateFullLevel) ──
{
  for (const shape of ["kalp", "halka", "ok", "cerceve", "dolu"]) {
    const rows = 10, cols = 8;
    const mask = TM_SHAPES.maskFor(shape, rows, cols);
    const lv = generateFullLevel({ rows, cols, mask, seed: 4242 });
    const tag = "tam dolu " + shape;
    check(tag + ": üretildi", !!lv);
    if (!lv) continue;
    check(tag + ": %100 dolu (taş = maske alanı)", lv.pairs.length * 2 === lv.maskArea);
    check(tag + ": bitişik hizalı çift yok", !lv.pairs.some(isAdjacentCollinear));
    check(tag + ": çözülebilir", pairsCurve(lv.pairs, rows, cols) !== null);
    check(tag + ": deadlock yok", analyzeFlow(lv.pairs, rows, cols).deadlocked.length === 0);
    const lv2 = generateFullLevel({ rows, cols, mask, seed: 4242 });
    check(tag + ": deterministik", JSON.stringify(lv2.pairs) === JSON.stringify(lv.pairs));
  }
  // maske yoksa merkez oyulur, yine üretilir (tam dikdörtgen tap hücresiz oynanamaz)
  const lv = generateFullLevel({ rows: 6, cols: 6, seed: 7 });
  check("tam dolu maskesiz: merkez oyularak üretildi",
    !!lv && lv.maskArea === 34 && lv.pairs.length === 17);
}

// ── Soyma akış kadranları: yön tutuyorlar mı? (sabit seed → deterministik) ──
{
  const mask = TM_SHAPES.maskFor("kalp", 10, 8);
  const avg = (opts, f) => {
    let s = 0, k = 0;
    for (let i = 0; i < 6; i++) {
      const lv = generateFullLevel({ rows: 10, cols: 8, mask, ...opts, seed: 7000 + i });
      if (lv) { s += f(lv); k++; }
    }
    return s / k;
  };
  const avgSpan = (lv) => lv.pairs.reduce((a, [[r1, c1], [r2, c2]]) =>
    a + Math.abs(r1 - r2) + Math.abs(c1 - c2), 0) / lv.pairs.length;
  const locality = (lv) => {
    let d = 0;
    const mid = (p) => [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2];
    for (let i = 1; i < lv.pairs.length; i++) {
      const a = mid(lv.pairs[i - 1]), b = mid(lv.pairs[i]);
      d += Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
    }
    return d / (lv.pairs.length - 1);
  };
  check("kadran: köşeP yön tutuyor",
    avg({ cornerP: 0.05 }, (l) => l.curve.cornerShare) <
    avg({ cornerP: 0.95 }, (l) => l.curve.cornerShare));
  check("kadran: mesafe eğilimi yön tutuyor",
    avg({ spanBias: 0 }, avgSpan) < avg({ spanBias: 1 }, avgSpan));
  check("kadran: bel hedefi çekiyor",
    avg({ waistOpen: 6 }, (l) => l.waistOpenAbs) >
    avg({}, (l) => l.waistOpenAbs) + 1);
  check("kadran: yılan cephesi yerelliği düşürüyor",
    avg({ frontMode: "yilan" }, locality) < avg({}, locality) - 0.5);
  check("kadran: girişN dalga-0'ı sınırlıyor",
    avg({ frontMode: "cepheler", entryN: 3 }, (l) => l.entries) <
    avg({}, (l) => l.entries));
  // kadranlı üretim de sözleşmeyi korur
  const lv = generateFullLevel({
    rows: 10, cols: 8, mask, seed: 4242,
    frontMode: "bolge", entryN: 3, cornerP: 0.5, waistOpen: 3, spanBias: 0.5,
  });
  check("kadranlı: üretildi + %100 dolu", !!lv && lv.pairs.length * 2 === lv.maskArea);
  check("kadranlı: çözülebilir", !!lv && pairsCurve(lv.pairs, 10, 8) !== null);
  const lv2 = generateFullLevel({
    rows: 10, cols: 8, mask, seed: 4242,
    frontMode: "bolge", entryN: 3, cornerP: 0.5, waistOpen: 3, spanBias: 0.5,
  });
  check("kadranlı: deterministik", JSON.stringify(lv2.pairs) === JSON.stringify(lv.pairs));
}

// ── Funnel paketleri (levels_gen.js: boyut başına 100 level) ──
{
  const { TM_PACKS } = require("../levels_gen.js");
  const CYCLE = ["easy", "easy", "medium", "medium", "hard",
                 "easy", "easy", "medium", "veryhard", "easy"];
  check("paketler var", Array.isArray(TM_PACKS) && TM_PACKS.length >= 5);

  for (const pk of TM_PACKS) {
    const P = pk.levels, tag = "paket " + pk.size;
    check(tag + ": 100 level", P.length === 100);
    check(tag + ": idler 1..100 sıralı", P.every((l, i) => l.id === i + 1));
    check(tag + ": etiketler döngüye uyuyor",
      P.every((l, i) => l.meta.label === CYCLE[i % 10]));
    check(tag + ": boyut tutarlı",
      P.every((l) => l.rows === pk.rows && l.cols === pk.cols));

    // doluluk sözleşmesi: taban 0.44 (gevşetme dahil), ortalama ≥ 0.50
    const fills = P.map((l) => l.meta.fill);
    check(tag + ": doluluk tabanı", Math.min(...fills) >= 0.44);
    check(tag + ": ort. doluluk >= 0.50",
      fills.reduce((a, b) => a + b, 0) / fills.length >= 0.5);

    // çözülebilirlik: dalga analizi hepsi; FIFO simülasyonu örneklem
    // (deadlock yoksa monotonluk çözülebilirliği garantiler)
    let solvable = true, fifoOk = true;
    for (const l of P) {
      const fl = analyzeFlow(l.pairs, l.rows, l.cols);
      if (fl.deadlocked.length) { solvable = false; console.error("  deadlock: " + pk.size + " #" + l.id); }
      if (l.id % 7 === 0 && pairsCurve(l.pairs, l.rows, l.cols) === null) {
        fifoOk = false; console.error("  FIFO tıkalı: " + pk.size + " #" + l.id);
      }
    }
    check(tag + ": deadlock yok", solvable);
    check(tag + ": FIFO örneklemi akıyor", fifoOk);

    // zorluk korelasyonu
    const meanOf = (d, lab) => {
      const xs = P.slice((d - 1) * 10, d * 10)
        .filter((l) => l.meta.label === lab).map((l) => l.meta.score);
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    };
    let ordered = true;
    for (let d = 1; d <= 10; d++) {
      if (!(meanOf(d, "easy") < meanOf(d, "medium") &&
            meanOf(d, "medium") < meanOf(d, "hard") &&
            meanOf(d, "hard") <= meanOf(d, "veryhard") + 1e-9)) ordered = false;
    }
    check(tag + ": her dekatta easy < medium < hard <= veryhard", ordered);
    check(tag + ": veryhard trendi yükseliyor",
      (meanOf(9, "veryhard") + meanOf(10, "veryhard")) / 2 >
      (meanOf(1, "veryhard") + meanOf(2, "veryhard")) / 2);
  }
}

// ── Tam dolu şekil paketleri (levels_shapes.js: boyut başına 50 level) ──
{
  const { TM_SHAPE_PACKS } = require("../levels_shapes.js");
  const BAND_LABELS = ["easy", "easy", "medium", "hard", "veryhard"];
  check("şekil paketleri var", Array.isArray(TM_SHAPE_PACKS) && TM_SHAPE_PACKS.length === 10);

  for (const pk of TM_SHAPE_PACKS) {
    const P = pk.levels, tag = "paket " + pk.size;
    check(tag + ": 50 level", P.length === 50);
    check(tag + ": idler 1..50 sıralı", P.every((l, i) => l.id === i + 1));
    check(tag + ": boyut tutarlı", P.every((l) => l.rows === pk.rows && l.cols === pk.cols));
    check(tag + ": etiketler banda uyuyor",
      P.every((l, i) => l.meta.label === BAND_LABELS[Math.floor(i / 10)]));
    check(tag + ": %100 dolu", P.every((l) => l.pairs.length * 2 === l.meta.maskArea));
    check(tag + ": 4 şekil de var",
      new Set(P.map((l) => l.meta.shape)).size === 4);

    // çözülebilirlik: dalga analizi hepsi, FIFO örneklem
    let solvable = true, fifoOk = true;
    for (const l of P) {
      if (analyzeFlow(l.pairs, l.rows, l.cols).deadlocked.length) {
        solvable = false; console.error("  deadlock: " + pk.size + " #" + l.id);
      }
      if (l.id % 7 === 0 && pairsCurve(l.pairs, l.rows, l.cols) === null) {
        fifoOk = false; console.error("  FIFO tıkalı: " + pk.size + " #" + l.id);
      }
    }
    check(tag + ": deadlock yok", solvable);
    check(tag + ": FIFO örneklemi akıyor", fifoOk);
  }
}

console.log(nFail === 0
  ? "\nOK — " + nOk + " test geçti"
  : "\n" + nFail + " test KIRIK (" + nOk + " geçti)");
process.exit(nFail === 0 ? 0 : 1);
