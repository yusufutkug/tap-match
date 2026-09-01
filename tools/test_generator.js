"use strict";

// Üretici duman testi + istatistik. Çalıştırma: node tools/test_generator.js

const { isAdjacentCollinear } = require("../js/board.js");
const { analyzeFlow, pairsCurve } = require("../js/flow.js");
const { generateLevel, generateCandidates } = require("../js/generator.js");

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

// ── Funnel paketi (levels_gen.js) ──
{
  const { TM_GEN_LEVELS } = require("../levels_gen.js");
  const P = TM_GEN_LEVELS;
  check("paket: 100 level", P.length === 100);
  check("paket: idler 1..100 sıralı", P.every((l, i) => l.id === i + 1));

  const CYCLE = ["easy", "easy", "medium", "medium", "hard",
                 "easy", "easy", "medium", "veryhard", "easy"];
  check("paket: etiketler döngüye uyuyor",
    P.every((l, i) => l.meta.label === CYCLE[i % 10]));
  check("paket: 49 ve 99 dev 12×18",
    P[48].cols === 12 && P[48].rows === 18 && P[98].cols === 12 && P[98].rows === 18);

  let solvable = true;
  for (const l of P) {
    const fl = analyzeFlow(l.pairs, l.rows, l.cols);
    if (fl.deadlocked.length || pairsCurve(l.pairs, l.rows, l.cols) === null) {
      solvable = false;
      console.error("  çözülemez: level " + l.id);
    }
  }
  check("paket: 100/100 çözülebilir", solvable);

  // Zorluk korelasyonu: her dekatta etiket ortalamaları sıralı; ilk dekat
  // en kolay başlangıç, very hard skoru son dekatta ilk dekattan yüksek.
  const meanOf = (d, lab) => {
    const xs = P.slice((d - 1) * 10, d * 10)
      .filter((l) => l.meta.label === lab).map((l) => l.meta.score);
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  };
  let ordered = true;
  for (let d = 1; d <= 10; d++) {
    if (!(meanOf(d, "easy") < meanOf(d, "medium") &&
          meanOf(d, "medium") < meanOf(d, "hard") &&
          meanOf(d, "hard") <= meanOf(d, "veryhard"))) ordered = false;
  }
  check("paket: her dekatta easy < medium < hard <= veryhard", ordered);
  check("paket: easy trendi yükseliyor", meanOf(10, "easy") > meanOf(1, "easy"));
  check("paket: veryhard trendi yükseliyor", meanOf(10, "veryhard") > meanOf(1, "veryhard"));
  const meanAll = P.reduce((a, l) => a + l.meta.score, 0) / P.length;
  check("paket: başlangıç kolay (level 1 skoru < paket ort. yarısı)",
    P[0].meta.score < meanAll / 2);
}

console.log(nFail === 0
  ? "\nOK — " + nOk + " test geçti"
  : "\n" + nFail + " test KIRIK (" + nOk + " geçti)");
process.exit(nFail === 0 ? 0 : 1);
