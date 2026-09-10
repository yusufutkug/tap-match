"use strict";

// Ölçüm katmanı duman testleri: analyzeFlow (AND/OR dalga) + pairsCurve.
// Çalıştırma: node tools/test_flow.js

const { boardFromPairs } = require("../js/board.js");
const { pairOptions, analyzeFlow, pairsCurve, effortCurve, boardEfforts, boardSalience,
  boardSweep, botEfforts, SEARCH_BOTS, CURVE_TEMPLATES, templateAt,
  shapeScore } = require("../js/flow.js");
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

// ── effortCurve: min-efor açgözlü bot ──

// İkisi de açıkken bot ucuz hamleyi (kısa koridor) pahalıdan (uzak köşe) önce oynar.
{
  const pairs = [[[0, 0], [0, 2]], [[2, 2], [4, 4]]];
  const ec = effortCurve(pairs, 6, 6);
  check("bot: koridor köşeden önce", ec !== null && ec.order[0] === 0);
  check("bot: köşe adımı daha pahalı", ec.effort[1] > ec.effort[0]);
}

// boardEfforts (canlı gösterge, oyun içi) ile effortCurve aynı hesap:
// adım-0'da eğrinin ilk değeri = en ucuz hücrenin eforu; parts dökümü tam.
{
  const lv = TM_LEVELS[5]; // Kavşak
  const board = boardFromPairs(lv.rows, lv.cols, lv.pairs);
  const ef = boardEfforts(board, lv.pairs, null);
  const ec = effortCurve(lv.pairs, lv.rows, lv.cols);
  const min = Math.min(...ef.cells.map((c) => c.effort));
  check("boardEfforts: adım-0 = eğri[0]", Math.abs(min - ec.effort[0]) < 1e-9);
  check("boardEfforts: parts toplamı = efor", ef.cells.every((c) => {
    const p = c.parts;
    return Math.abs(p.kind + p.span + p.corner + p.dist + p.search + p.noise - c.effort) < 1e-9;
  }));
}

// Çapraz kilit deadlock → null (pairsCurve ile aynı sözleşme).
{
  const pairs = [[[2, 2], [4, 4]], [[2, 4], [4, 2]]];
  check("bot: deadlock null", effortCurve(pairs, 6, 6) === null);
  check("salience: deadlock null", effortCurve(pairs, 6, 6, null, "salience") === null);
}

// ── boardSalience: search/match point modeli ──

// Tek hizalı çift (span 4, 6×6): koridor 3 hücre, hepsi match point.
// Search: iki taşın karşılıklı ışınları koridoru 2'şer sayar = 6; dik
// ışınlar kesişimsiz (0). Efor = 6/3 = 2 her koridor hücresinde.
{
  const pairs = [[[2, 0], [2, 4]]];
  const board = boardFromPairs(6, 6, pairs);
  const sal = boardSalience(board, pairs);
  check("salience: koridor search=6", sal.searchPts === 6);
  check("salience: koridor 3 match hücresi",
    sal.cells.length === 3 && sal.cells.every((c) => c.matchPts === 3));
  check("salience: koridor eforu 2", sal.cells.every((c) => Math.abs(c.effort - 2) < 1e-9));
}

// Koridor + köşe aynı boardda: koridor hücresi (çok match point) köşe
// hücresinden (1-2 match point) ucuz — bot koridoru önce oynar.
{
  const pairs = [[[0, 0], [0, 4]], [[2, 2], [5, 5]]];
  const board = boardFromPairs(6, 6, pairs);
  const sal = boardSalience(board, pairs);
  const corridor = sal.cells.find((c) => c.r === 0 && c.c === 2);
  const corner = sal.cells.find((c) => c.pairIds.includes(1));
  check("salience: koridor < köşe", corridor && corner && corridor.effort < corner.effort);
  const ec = effortCurve(pairs, 6, 6, null, "salience");
  check("salience: bot koridoru önce oynar", ec.order[0] === 0);
}

// Tüm leveller: salience botu da çözer, efor sonlu ve pozitif.
for (const lv of TM_LEVELS) {
  const ec = effortCurve(lv.pairs, lv.rows, lv.cols, null, "salience");
  check("level " + lv.id + ": salience bot çözer",
    ec !== null && ec.order.length === lv.pairs.length);
  check("level " + lv.id + ": salience eforu sonlu",
    ec.effort.every((x) => Number.isFinite(x) && x > 0));
}

// ── boardSweep: tarama (halka süpürme) modeli ──

// Tek hizalı çift (2,0)-(2,4), 6×6, merkezden tarama: ilk bulunan koridor
// hücresi (2,2) (d=1, satır-major), eforu kendi 2 incidence'ı; sonraki
// koridor hücrelerine varış kümülatif büyür. Havuz = 6 (salience ile aynı).
{
  const pairs = [[[2, 0], [2, 4]]];
  const board = boardFromPairs(6, 6, pairs);
  const sw = boardSweep(board, pairs, null);
  check("sweep: havuz 6", sw.searchPts === 6);
  const at = (r, c) => sw.cells.find((x) => x.r === r && x.c === c);
  check("sweep: ilk bulunan (2,2) efor 2", at(2, 2) && at(2, 2).effort === 2);
  check("sweep: varış kümülatif artar",
    at(2, 3).effort === 4 && at(2, 1).effort === 6);
  // başlangıç sola kayınca ilk bulunan (2,1) olur ve efor 2'ye düşer
  const sw2 = boardSweep(board, pairs, [2, 0]);
  const first = sw2.cells.reduce((a, b) => (a.effort <= b.effort ? a : b));
  check("sweep: başlangıç yerelliği", first.r === 2 && first.c === 1 && first.effort === 2);
}

// Tüm leveller: sweep botu çözer, efor sonlu, deterministik; deadlock null.
{
  const pairs = [[[2, 2], [4, 4]], [[2, 4], [4, 2]]];
  check("sweep: deadlock null", effortCurve(pairs, 6, 6, null, "sweep") === null);
}
for (const lv of TM_LEVELS) {
  const ec = effortCurve(lv.pairs, lv.rows, lv.cols, null, "sweep");
  check("level " + lv.id + ": sweep bot çözer",
    ec !== null && ec.order.length === lv.pairs.length);
  check("level " + lv.id + ": sweep eforu sonlu",
    ec.effort.every((x) => Number.isFinite(x) && x >= 0));
  const ec2 = effortCurve(lv.pairs, lv.rows, lv.cols, null, "sweep");
  check("level " + lv.id + ": sweep deterministik",
    JSON.stringify(ec2.moves) === JSON.stringify(ec.moves));
}

// ── Bot ailesi: sweep/center/raster/ray/memory/mix ──

// Okuyucu bot satır-major ilk match'i oynar (deterministik konum önyargısı).
{
  const pairs = [[[0, 1], [0, 3]], [[5, 1], [5, 3]]]; // iki özdeş koridor
  const ecR = effortCurve(pairs, 6, 6, null, "raster");
  check("raster: üstteki koridor önce", ecR.moves[0].r === 0);
}

// Işın takipçisi: tek koridor çiftinde en yakın taşın ışını ilk hücrede
// match bulur → efor 1 (hücre-süpürücüden farklı en ucuz keşif).
{
  const pairs = [[[2, 0], [2, 4]]];
  const board = boardFromPairs(6, 6, pairs);
  const ef = botEfforts(board, pairs, "ray", { last: null, step: 0, mem: new Map() });
  const first = ef.cells.reduce((a, b) => (a.effort <= b.effort ? a : b));
  check("ray: ilk keşif eforu 1", first.effort === 1);
}

// Hafızalı bot: aynı gezinti, hatırlanan hücreler bedava → adım eforu
// hafızasız süpürücüyü aşamaz (yörünge aynı kaldığı sürece).
{
  const lv = TM_LEVELS[5]; // Kavşak
  const sw = effortCurve(lv.pairs, lv.rows, lv.cols, null, "sweep");
  const me = effortCurve(lv.pairs, lv.rows, lv.cols, null, "memory");
  const swTot = sw.effort.reduce((a, b) => a + b, 0);
  const meTot = me.effort.reduce((a, b) => a + b, 0);
  check("memory: toplam efor ≤ sweep", meTot <= swTot + 1e-9);
}

// ── Efor eğrisi şekil hedefleri (CURVE_TEMPLATES / shapeScore) ──
{
  const tpl = CURVE_TEMPLATES.bel;
  check("templateAt: uçlar ve zirve",
    templateAt(tpl, 0) === 0.3 && templateAt(tpl, 0.5) === 1 && templateAt(tpl, 1) === 0.3);
  check("templateAt: ara değer doğrusal", Math.abs(templateAt(tpl, 0.25) - 0.65) < 1e-9);
  // şablonun kendisi (keyfi ölçekle) ≈ 0 skor; düz eğri belden uzak
  const L = 41;
  const eff = Array.from({ length: L }, (_, i) => 7 * templateAt(tpl, i / (L - 1)));
  const own = shapeScore(eff, tpl);
  check("shapeScore: şablonun kendisi ≈ 0", own < 0.05);
  check("shapeScore: düz eğri belden uzak", shapeScore(Array(L).fill(5), tpl) > own + 0.1);
  // dalga şablonu kendi şablonuna, bel şablonundan daha yakın
  const wv = CURVE_TEMPLATES.dalga;
  const effW = Array.from({ length: L }, (_, i) => 3 * templateAt(wv, i / (L - 1)));
  check("shapeScore: dalga kendi şablonuna daha yakın",
    shapeScore(effW, wv) < shapeScore(effW, tpl));
}

// Tüm botlar tüm öğretici levelleri çözer, sonlu ve deterministik.
for (const bot of SEARCH_BOTS) {
  for (const lv of TM_LEVELS) {
    const ec = effortCurve(lv.pairs, lv.rows, lv.cols, null, bot);
    check("level " + lv.id + " " + bot + ": çözer",
      ec !== null && ec.order.length === lv.pairs.length &&
      new Set(ec.order).size === lv.pairs.length);
    check("level " + lv.id + " " + bot + ": sonlu",
      ec.effort.every((x) => Number.isFinite(x) && x >= 0));
    const ec2 = effortCurve(lv.pairs, lv.rows, lv.cols, null, bot);
    check("level " + lv.id + " " + bot + ": deterministik",
      JSON.stringify(ec2.moves) === JSON.stringify(ec.moves));
  }
}

// Tüm leveller: bot çözer, efor sonlu ve deterministik.
for (const lv of TM_LEVELS) {
  const ec = effortCurve(lv.pairs, lv.rows, lv.cols);
  check("level " + lv.id + ": bot çözer",
    ec !== null && ec.order.length === lv.pairs.length &&
    new Set(ec.order).size === lv.pairs.length);
  check("level " + lv.id + ": bot eforu sonlu",
    ec.effort.every((x) => Number.isFinite(x) && x >= 0));
  const ec2 = effortCurve(lv.pairs, lv.rows, lv.cols);
  check("level " + lv.id + ": bot deterministik",
    JSON.stringify(ec2.moves) === JSON.stringify(ec.moves));
}

// Level 4 (Kilit): P0, P1'e bağımlı → depth >= 2 ve P0 dalga >= 1.
{
  const lv = TM_LEVELS.find((l) => l.id === 4);
  const flow = analyzeFlow(lv.pairs, lv.rows, lv.cols);
  check("level 4: kilit derinliği", flow.depth >= 2 && flow.waves[0] >= 1);
}

// ── Rapor: level başına özet (görsel doğrulama için) ──
console.log("\nlevel  çift  giriş  depth  dalga        dip   waistPos  effortPeak  köşe%  botMaks  bot@t");
for (const lv of TM_LEVELS) {
  const flow = analyzeFlow(lv.pairs, lv.rows, lv.cols);
  const cv = pairsCurve(lv.pairs, lv.rows, lv.cols);
  const ec = effortCurve(lv.pairs, lv.rows, lv.cols);
  console.log(
    String(lv.id).padEnd(7) +
    String(flow.pairs).padEnd(6) +
    String(flow.entries).padEnd(7) +
    String(flow.depth).padEnd(7) +
    ("[" + flow.waveWidths.join(",") + "]").padEnd(13) +
    cv.dip.toFixed(2).padEnd(6) +
    cv.waistPos.toFixed(2).padEnd(10) +
    cv.effortPeak.toFixed(1).padEnd(12) +
    ((cv.cornerShare * 100).toFixed(0) + "%").padEnd(7) +
    ec.effortMax.toFixed(2).padEnd(9) +
    ec.effortMaxPos.toFixed(2)
  );
}

console.log(nFail === 0
  ? "\nOK — " + nOk + " test geçti"
  : "\n" + nFail + " test KIRIK (" + nOk + " geçti)");
process.exit(nFail === 0 ? 0 : 1);
