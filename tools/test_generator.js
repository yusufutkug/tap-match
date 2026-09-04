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

// ── Ada maskeleri (js/shapes.js): her boyutta ≥2 ada, hepsi üretilebilir ──
{
  const SIZES = [[8, 6], [9, 6], [9, 7], [10, 7], [10, 8],
                 [12, 8], [14, 8], [12, 9], [15, 9], [18, 12]];
  const comps = (mask, rows, cols) => {
    const seen = mask.map((r) => r.map(() => false));
    let n = 0, minSize = Infinity;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!mask[r][c] || seen[r][c]) continue;
        n++;
        let size = 0;
        const q = [[r, c]];
        seen[r][c] = true;
        while (q.length) {
          const [a, b] = q.pop();
          size++;
          for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const rr = a + dr, cc = b + dc;
            if (rr >= 0 && cc >= 0 && rr < rows && cc < cols &&
                mask[rr][cc] && !seen[rr][cc]) { seen[rr][cc] = true; q.push([rr, cc]); }
          }
        }
        minSize = Math.min(minSize, size);
      }
    }
    return { n, minSize };
  };
  const WANT = { papyon: 2, yonca: 4, takimada: 3, bantlar: 3 };
  for (const id of Object.keys(WANT)) {
    let adaOk = true, genOk = true;
    for (const [rows, cols] of SIZES) {
      const mask = TM_SHAPES.maskFor(id, rows, cols);
      const cc = mask && comps(mask, rows, cols);
      if (!mask || cc.n !== WANT[id] || cc.minSize < 4) adaOk = false;
      const lv = generateFullLevel({ rows, cols, mask, seed: 1234 });
      if (!lv || pairsCurve(lv.pairs, rows, cols) === null ||
          analyzeFlow(lv.pairs, rows, cols).deadlocked.length) genOk = false;
    }
    check("ada maskesi " + id + ": her boyutta " + WANT[id] + " ada (≥4 hücre)", adaOk);
    check("ada maskesi " + id + ": her boyutta üretilebilir + çözülebilir", genOk);
  }
}

// ── Kesme hattı (cut) + yerellik metriği ──
{
  const { localityStats } = require("../js/flow.js");

  // dolu board + dikey kesme: erken bölünme, çözülebilirlik, determinizm
  const lv = generateFullLevel({ rows: 10, cols: 8, seed: 7, cut: "dikey" });
  check("kesme: üretildi + hat var", !!lv && lv.cutCells && lv.cutCells.length >= 8);
  check("kesme: çözülebilir", !!lv && pairsCurve(lv.pairs, 10, 8) !== null);
  const loc = lv && localityStats(lv.pairs, 10, 8);
  check("kesme: oyun erken bölünüyor (splitT ≤ 0.35, ≥2 parça)",
    !!loc && loc.splitT !== null && loc.splitT <= 0.35 && loc.maxComps >= 2);
  const lvB = generateFullLevel({ rows: 10, cols: 8, seed: 7, cut: "dikey" });
  check("kesme: deterministik", !!lvB && JSON.stringify(lvB.pairs) === JSON.stringify(lv.pairs));

  // şekilli kesme: çerçeve dikeyde bölünür; bölünemeyen yön null döner
  const frame = TM_SHAPES.maskFor("cerceve", 10, 8);
  const lvF = generateFullLevel({ rows: 10, cols: 8, mask: frame, seed: 42, cut: "dikey" });
  check("kesme: çerçeve + dikey üretildi", !!lvF && pairsCurve(lvF.pairs, 10, 8) !== null);

  // yerellik metriği: sözleşme + determinizm
  const l1 = localityStats(lv.pairs, 10, 8);
  const l2 = localityStats(lv.pairs, 10, 8);
  check("yerellik: deterministik", JSON.stringify(l1.jumps) === JSON.stringify(l2.jumps));
  check("yerellik: alanlar tutarlı",
    l1.jumps.length === l1.opens.length && l1.meanJump >= 0 &&
    l1.grindMax >= 0 && Array.isArray(l1.knotAt));

  // yerellik cezası yön tutuyor: skorlamalı üretim (yeni) kuyruk saçılmasını
  // eski adaylara göre düşürmeli — kalp maskesinde 6 seed ortalaması
  const heart = TM_SHAPES.maskFor("kalp", 10, 8);
  let tails = 0, k = 0;
  for (let i = 0; i < 6; i++) {
    const l = generateFullLevel({ rows: 10, cols: 8, mask: heart, seed: 9000 + i });
    if (l && l.loc) { tails += l.loc.grindMax; k++; }
  }
  check("yerellik: seçilen adaylarda öğütme düşük (ort ≤ 1.5)", k > 0 && tails / k <= 1.5);

  // tempo senaryosu: knots kadranı düğüm sayısını iki yönde de yönetiyor —
  // hedef 0 doğal (kapalı) durumdan azaltır, hedef 4 hedef 0'dan çoğaltır
  const knotAvg = (knots) => {
    let s = 0, n = 0;
    for (let i = 0; i < 5; i++) {
      const l = generateFullLevel({
        rows: 12, cols: 9, mask: TM_SHAPES.maskFor("kalp", 12, 9),
        seed: 100 + i, frontMode: "bolge", knots,
      });
      if (l) { s += l.loc.knots; n++; }
    }
    return s / n;
  };
  const kOff = knotAvg(null), k0 = knotAvg(0), k4 = knotAvg(4);
  check("tempo: düğüm hedefi 0 doğal düğümleri bastırıyor", k0 < kOff - 1);
  check("tempo: düğüm hedefi 4 > hedef 0", k4 > k0 + 0.5);
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
    check(tag + ": şekil çeşitliliği (≥8: tek parça + ada + dolu)",
      new Set(P.map((l) => l.meta.shape)).size >= 8);

    // tempo rampası: bant düğüm ortalaması kolaydan zora yükselmeli
    const bandAvg = (b) => {
      const xs = P.slice(b * 10, (b + 1) * 10).map((l) => l.meta.knots);
      return xs.reduce((a, x) => a + x, 0) / xs.length;
    };
    check(tag + ": düğüm rampası (bant1 + 0.5 < bant5)", bandAvg(0) + 0.5 < bandAvg(4));

    // kesme: planlanan hatların çoğu tutmalı, tutanlar erken bölünmeli
    const cuts = P.filter((l) => l.meta.cut);
    check(tag + ": kesmeli level ≥ 12", cuts.length >= 12);
    const earlySplit = cuts.filter((l) => l.meta.splitT !== null && l.meta.splitT <= 0.5);
    check(tag + ": kesmelilerin ≥%60'ı erken bölünüyor", earlySplit.length >= cuts.length * 0.6);

    // öğütme tavanı: art arda zorunlu-uzak hamle zinciri kontrol altında
    check(tag + ": öğütme ≤ 4", P.every((l) => l.meta.grind <= 4));

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
