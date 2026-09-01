"use strict";

// Ölçüm katmanı duman testleri: analyzeFlow (AND/OR dalga) + pairsCurve.
// Çalıştırma: node tools/test_flow.js

const { boardFromPairs } = require("../js/board.js");
const { pairOptions, analyzeFlow, pairsCurve } = require("../js/flow.js");
const { TM_LEVELS } = require("../levels.js");

let nOk = 0, nFail = 0;
function check(name, cond) {
  if (cond) { nOk++; }
  else { nFail++; console.error("FAIL: " + name); }
}

// ── pairOptions ──

// Hizalı çift: tek seçenek, koridordaki taşların sahipleri.
{
  const pairs = [[[0, 0], [0, 4]], [[0, 2], [3, 2]]];
  const b = boardFromPairs(4, 5, pairs);
  const opts = pairOptions(b, pairs[0]);
  check("options: hizalı tek seçenek", opts.length === 1);
  check("options: koridor blokeri P1", opts[0].has(1) && opts[0].size === 1);
}

// Hizasız çift: iki seçenek (köşe başına); köşe hücresi + bacak blokerleri.
{
  const pairs = [[[0, 0], [2, 2]], [[0, 2], [3, 3]], [[2, 0], [4, 4]]];
  // P0 köşeleri: (0,2) P1 taşıyla dolu; (2,0) P2 taşıyla dolu.
  const b = boardFromPairs(5, 5, pairs);
  const opts = pairOptions(b, pairs[0]);
  check("options: hizasız iki seçenek", opts.length === 2);
  check("options: köşe işgalleri yakalanır",
    opts.some((s) => s.has(1)) && opts.some((s) => s.has(2)));
}

// Span-1 hizalı çift: sıfır seçenek.
{
  const pairs = [[[1, 1], [1, 2]]];
  const b = boardFromPairs(3, 4, pairs);
  check("options: span-1 ölü", pairOptions(b, pairs[0]).length === 0);
}

// ── analyzeFlow: deadlock tespiti ──

// Çapraz köşe kilidi: iki hizasız çift birbirinin köşelerine oturur → ∞ dalga.
{
  const pairs = [[[2, 2], [4, 4]], [[2, 4], [4, 2]]];
  const flow = analyzeFlow(pairs, 6, 6);
  check("deadlock: çapraz kilit tespit", flow.deadlocked.length === 2);
  check("deadlock: pairsCurve null", pairsCurve(pairs, 6, 6) === null);
}

// Span-1 çift içeren level de deadlock.
{
  const pairs = [[[0, 0], [0, 3]], [[2, 1], [2, 2]]];
  const flow = analyzeFlow(pairs, 4, 4);
  check("deadlock: span-1 tespit", flow.deadlocked.includes(1));
}

// Basit zincir: P0 koridoru P1 taşıyla kapalı → dalga(P0)=1, dalga(P1)=0.
{
  const pairs = [[[2, 1], [2, 4]], [[2, 2], [4, 2]]];
  const flow = analyzeFlow(pairs, 6, 6);
  check("zincir: dalgalar 1,0", flow.waves[0] === 1 && flow.waves[1] === 0);
  check("zincir: depth 2", flow.depth === 2);
  check("zincir: entries 1", flow.entries === 1);
}

// OR semantiği: hizasız çiftin bir köşesi kapalı, diğeri açık → dalga 0.
{
  const pairs = [[[0, 0], [2, 2]], [[0, 2], [4, 2]]];
  // P0 köşe (0,2) dolu ama (2,0) açık → P0 dalga-0.
  const flow = analyzeFlow(pairs, 5, 5);
  check("OR: açık köşe dalga-0 yapar", flow.waves[0] === 0);
}

// ── pairsCurve: temel değişmezler ──

{
  const lv = TM_LEVELS[3]; // Kilit
  const cv = pairsCurve(lv.pairs, lv.rows, lv.cols);
  check("curve: çözüm tamamlanır", cv !== null && cv.order.length === lv.pairs.length);
  check("curve: order permütasyon",
    new Set(cv.order).size === lv.pairs.length);
  check("curve: oranlar (0,1] içinde",
    cv.curve.every((x) => x > 0 && x <= 1));
  check("curve: effort >= 1", cv.effort.every((x) => x >= 1));
}

// ── Tüm leveller: flow + curve tutarlılığı ──

for (const lv of TM_LEVELS) {
  const flow = analyzeFlow(lv.pairs, lv.rows, lv.cols);
  const cv = pairsCurve(lv.pairs, lv.rows, lv.cols);
  check("level " + lv.id + ": deadlock yok", flow.deadlocked.length === 0);
  check("level " + lv.id + ": curve çözer", cv !== null);
  check("level " + lv.id + ": dalga-0 = entries", flow.waveWidths[0] === flow.entries);
  // Dalga sayısı, FIFO çözümün uzunluğunu aşamaz
  check("level " + lv.id + ": depth <= n", flow.depth <= lv.pairs.length);
}

// Level 4 (Kilit): P0, P1'e bağımlı → depth >= 2 ve P0 dalga >= 1.
{
  const lv = TM_LEVELS.find((l) => l.id === 4);
  const flow = analyzeFlow(lv.pairs, lv.rows, lv.cols);
  check("level 4: kilit derinliği", flow.depth >= 2 && flow.waves[0] >= 1);
}

// ── Rapor: level başına özet (görsel doğrulama için) ──
console.log("\nlevel  çift  giriş  depth  dalga        dip   waistPos  effortPeak  köşe%");
for (const lv of TM_LEVELS) {
  const flow = analyzeFlow(lv.pairs, lv.rows, lv.cols);
  const cv = pairsCurve(lv.pairs, lv.rows, lv.cols);
  console.log(
    String(lv.id).padEnd(7) +
    String(flow.pairs).padEnd(6) +
    String(flow.entries).padEnd(7) +
    String(flow.depth).padEnd(7) +
    ("[" + flow.waveWidths.join(",") + "]").padEnd(13) +
    cv.dip.toFixed(2).padEnd(6) +
    cv.waistPos.toFixed(2).padEnd(10) +
    cv.effortPeak.toFixed(1).padEnd(12) +
    (cv.cornerShare * 100).toFixed(0) + "%"
  );
}

console.log(nFail === 0
  ? "\nOK — " + nOk + " test geçti"
  : "\n" + nFail + " test KIRIK (" + nOk + " geçti)");
process.exit(nFail === 0 ? 0 : 1);
