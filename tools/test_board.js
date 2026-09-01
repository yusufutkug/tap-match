"use strict";

// Çekirdek duman testleri: resolveTap davranışları + level doğrulama.
// Çalıştırma: node tools/test_board.js

const {
  boardFromPairs, countTiles, visibleTilesFrom, resolveTap, applyMatches,
  availableTapCells, matchablePairs, isAdjacentCollinear,
} = require("../js/board.js");
const { TM_LEVELS } = require("../levels.js");

let nOk = 0, nFail = 0;
function check(name, cond) {
  if (cond) { nOk++; }
  else { nFail++; console.error("FAIL: " + name); }
}

// ── resolveTap davranışları ──

// Koridor eşleşmesi: aynı satır, ara boş.
{
  const b = boardFromPairs(3, 5, [[[1, 0], [1, 4]]]);
  const res = resolveTap(b, 1, 2);
  check("koridor: match", res.kind === "match");
  check("koridor: tek çift", res.matches.length === 1 && res.matches[0].pairId === 0);
}

// Köşe (L) eşleşmesi: hizasız çift, dikdörtgen köşesi.
{
  const b = boardFromPairs(4, 4, [[[0, 0], [2, 2]]]);
  check("köşe: (0,2) match", resolveTap(b, 0, 2).kind === "match");
  check("köşe: (2,0) match", resolveTap(b, 2, 0).kind === "match");
  check("köşe: (1,1) blank (çapraz görmez)", resolveTap(b, 1, 1).kind === "blank");
}

// Bacağı kapalı köşe eşleşmez.
{
  const b = boardFromPairs(4, 4, [[[0, 0], [2, 2]], [[0, 1], [3, 3]]]);
  // (0,2)→(0,0) bacağında (0,1) taşı var → P0 oradan eşleşmez.
  const res = resolveTap(b, 0, 2);
  check("kapalı bacak: köşeden match yok", !res.matches.some((m) => m.pairId === 0));
}

// Çifte patlama: dikey çift A + yatay çift B aynı hücreyi görür.
{
  const b = boardFromPairs(5, 5, [[[0, 2], [4, 2]], [[2, 0], [2, 4]]]);
  const res = resolveTap(b, 2, 2);
  check("combo: match", res.kind === "match");
  check("combo: iki çift birden", res.matches.length === 2);
}

// Karışık durum: çift + eşi olmayan taş → çift kırılır, tekil bounce'a girmez.
{
  const b = boardFromPairs(5, 5, [[[2, 0], [2, 4]], [[0, 2], [4, 4]]]);
  const res = resolveTap(b, 2, 2);
  check("karışık: match", res.kind === "match" && res.matches.length === 1);
  check("karışık: tekil taş bounce'ta değil", res.bounce.length === 0);
}

// Miss: gören taşlar var ama çift yok → hepsi bounce.
{
  const b = boardFromPairs(5, 5, [[[2, 0], [4, 4]], [[0, 2], [4, 0]]]);
  const res = resolveTap(b, 2, 2);
  check("miss: kind", res.kind === "miss");
  check("miss: 2 taş bounce", res.bounce.length === 2);
}

// Tek taş gören hücre → miss (1 taş bounce).
{
  const b = boardFromPairs(3, 3, [[[0, 0], [2, 2]]]);
  const res = resolveTap(b, 0, 1);
  check("tek taş: miss + 1 bounce", res.kind === "miss" && res.bounce.length === 1);
}

// Hiç taş görmeyen hücre → blank; dolu hücre → occupied.
{
  const b = boardFromPairs(5, 5, [[[0, 0], [2, 2]]]);
  check("blank", resolveTap(b, 4, 4).kind === "blank");
  check("occupied", resolveTap(b, 2, 2).kind === "occupied");
}

// Görüş taşta durur: araya taş girince arkadaki görünmez.
{
  const b = boardFromPairs(1, 5, [[[0, 0], [0, 4]], [[0, 2], [0, 3]]]);
  // (0,1) sağa bakınca (0,2)'yi görür, (0,4)'ü göremez.
  const seen = visibleTilesFrom(b, 0, 1);
  check("görüş taşta durur", !seen.some((t) => t.c === 4));
}

// Bitişik hizalı çift: hiçbir hücreden eşleşemez (yapısal deadlock).
{
  const b = boardFromPairs(3, 4, [[[1, 1], [1, 2]]]);
  check("bitişik çift: hiç tap hücresi yok", availableTapCells(b).length === 0);
  check("isAdjacentCollinear yakalar", isAdjacentCollinear([[1, 1], [1, 2]]));
  check("isAdjacentCollinear hizasıza dokunmaz", !isAdjacentCollinear([[0, 0], [1, 1]]));
}

// ── Level doğrulama: yasak yerleşim yok + greedy sim çözer ──

function simulate(lv) {
  const board = boardFromPairs(lv.rows, lv.cols, lv.pairs);
  let alive = lv.pairs.length, guard = 0;
  while (alive > 0 && guard++ < 500) {
    const cells = availableTapCells(board);
    if (cells.length === 0) return { solved: false, alive };
    const { r, c } = cells[0];
    const res = resolveTap(board, r, c);
    applyMatches(board, res.matches);
    alive -= res.matches.length;
  }
  return { solved: alive === 0 && countTiles(board) === 0, alive };
}

for (const lv of TM_LEVELS) {
  const cells = new Set();
  let overlap = false;
  for (const pair of lv.pairs) {
    for (const [r, c] of pair) {
      const k = r + "," + c;
      if (cells.has(k)) overlap = true;
      cells.add(k);
      if (r < 0 || r >= lv.rows || c < 0 || c >= lv.cols) overlap = true;
    }
  }
  check("level " + lv.id + ": hücreler benzersiz + sınır içinde", !overlap);
  check("level " + lv.id + ": bitişik hizalı çift yok",
    !lv.pairs.some(isAdjacentCollinear));
  const sim = simulate(lv);
  check("level " + lv.id + ": çözülebilir", sim.solved);
  if (!sim.solved) console.error("  → kalan çift: " + sim.alive);
}

// Level 6'nın kavşak hücresi gerçekten çifte patlama veriyor mu?
{
  const lv = TM_LEVELS.find((l) => l.id === 6);
  const b = boardFromPairs(lv.rows, lv.cols, lv.pairs);
  const res = resolveTap(b, 3, 3);
  check("level 6: (3,3) çifte patlama", res.kind === "match" && res.matches.length === 2);
}

console.log(nFail === 0
  ? "OK — " + nOk + " test geçti"
  : nFail + " test KIRIK (" + nOk + " geçti)");
process.exit(nFail === 0 ? 0 : 1);
