"use strict";

// Çekirdek duman testleri: resolveTap davranışları + level doğrulama.
// Çalıştırma: node tools/test_board.js

const {
  boardFromPairs, countTiles, visibleTilesFrom, resolveTap, applyMatches,
  availableTapCells, matchablePairs, isAdjacentCollinear,
  boardFromLevel, cloneGenerators, applyGenerators, generatorIssues, levelFromExternal,
} = require("../js/board.js");
const { TM_LEVELS } = require("../levels.js");
const { TM_MECH_LEVELS } = require("../levels_mekanik.js");

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

// ── Tile Generator ──

// Dış format → iç model dönüşümü (sol-alt köken, yön kodu, 1→0 tabanlı id).
{
  const lv = levelFromExternal({
    width: 3, height: 3,
    cells: [
      0, 2, 0,
      0, 1, 0,
      1, 0, 0,
    ],
    TileGenerators: [{ Cell: 7, Direction: 1, Tiles: [2] }],
  });
  check("ext: boyut", lv.rows === 3 && lv.cols === 3);
  check("ext: generator üst-orta, aşağı bakar",
    lv.generators[0].r === 0 && lv.generators[0].c === 1 && lv.generators[0].dir === "D");
  check("ext: kuyruk 0 tabanlı", lv.generators[0].queue[0] === 1);
  check("ext: çift 1 (iç 0) sol-üst + orta (sol-alt köken çevrildi)",
    lv.pairs[0].length === 2 &&
    lv.pairs[0].some(([r, c]) => r === 0 && c === 0) &&
    lv.pairs[0].some(([r, c]) => r === 1 && c === 1));
  check("ext: çift 2 (iç 1) altta + kuyrukta", lv.pairs[1].length === 1 && lv.pairs[1][0][0] === 2);
  check("ext: yerleşim geçerli", generatorIssues(lv).length === 0);
}

// Generator ışını keser ama eşleşmez; kuyruk önü boşalınca akar; son taşta kırılır.
{
  // r0: 5 . G . 5    G aşağı bakar, kuyruk [1,2]   (iç kimlikler 0 tabanlı)
  // r1: 0 . 0 . 1    ön = (1,2) içinde çift 0
  // r2: . . . . .
  // r3: . . 2 . .
  const lv = {
    rows: 4, cols: 5,
    pairs: [[[1, 0], [1, 2]], [[1, 4]], [[3, 2]], [[0, 0], [0, 4]]],
    generators: [{ r: 0, c: 2, dir: "D", queue: [1, 2] }],
  };
  check("gen: yerleşim geçerli", generatorIssues(lv).length === 0);
  const board = boardFromLevel(lv);
  const gens = cloneGenerators(lv.generators);
  check("gen: hücre negatif", board[0][2] < 0);
  check("gen: taş sayımına girmez", countTiles(board) === 6);
  check("gen: üst satır çifti G yüzünden kapalı", resolveTap(board, 0, 1).kind !== "match");
  check("gen: G'ye tap occupied", resolveTap(board, 0, 2).kind === "occupied");
  check("gen: G bounce'a girmez", !resolveTap(board, 0, 1).bounce.some(([, c]) => c === 2));
  {
    const b1 = boardFromLevel({ rows: 1, cols: 3, pairs: [],
      generators: [{ r: 0, c: 0, dir: "R", queue: [0] }] });
    check("gen: yalnız G gören hücre blank", resolveTap(b1, 0, 2).kind === "blank");
  }
  // önü dolu: üretim yok
  check("gen: önü doluyken üretmez", applyGenerators(board, gens).spawned.length === 0);
  // çift 0'ı kır → 1 öne gelir
  let res = resolveTap(board, 1, 1);
  check("gen: tıpa çifti match", res.kind === "match" && res.matches[0].pairId === 0);
  applyMatches(board, res.matches);
  let ev = applyGenerators(board, gens);
  check("gen: ön boşalınca üretir", ev.spawned.length === 1 && ev.spawned[0].pairId === 1 &&
    ev.spawned[0].r === 1 && ev.spawned[0].c === 2);
  check("gen: sayaç 1'e düştü, G yaşıyor", gens[0].queue.length === 1 && board[0][2] < 0 && ev.broken.length === 0);
  // çift 1: öne gelen 1 ile (1,4), arada (1,3)
  res = resolveTap(board, 1, 3);
  check("gen: üretilen taş eşleşir", res.kind === "match" && res.matches[0].pairId === 1);
  applyMatches(board, res.matches);
  ev = applyGenerators(board, gens);
  check("gen: son taş üretildi ve G kırıldı",
    ev.spawned.length === 1 && ev.broken.length === 1 && board[0][2] === null);
  check("gen: kırılan hücre dot (üst satır çifti açıldı)", resolveTap(board, 0, 2).kind === "match");
}

// Yapısal hatalar yakalanır.
{
  const base = { rows: 3, cols: 3, pairs: [[[1, 1]], [[2, 2], [0, 2]]] };
  const issues = (gens) => generatorIssues({ ...base, generators: gens });
  check("gen hata: aynı kuyrukta çiftin iki taşı",
    issues([{ r: 0, c: 1, dir: "D", queue: [0, 0] }]).some((s) => s.includes("iki taşı")));
  check("gen hata: önü board dışı",
    issues([{ r: 0, c: 1, dir: "U", queue: [0] }]).some((s) => s.includes("board dışı")));
  check("gen hata: önü başlangıçta boş",
    issues([{ r: 0, c: 0, dir: "D", queue: [0] }]).some((s) => s.includes("boş")));
  check("gen hata: kuyruk boş",
    issues([{ r: 0, c: 1, dir: "D", queue: [] }]).some((s) => s.includes("kuyruk boş")));
  check("gen: geçerli yerleşim temiz",
    issues([{ r: 0, c: 1, dir: "D", queue: [0] }]).length === 0);
}

// ── Level doğrulama: yasak yerleşim yok + greedy sim çözer ──

function simulate(lv) {
  const board = boardFromLevel(lv);
  const gens = cloneGenerators(lv.generators);
  let alive = lv.pairs.length, guard = 0;
  while (alive > 0 && guard++ < 500) {
    const cells = availableTapCells(board);
    if (cells.length === 0) return { solved: false, alive };
    const { r, c } = cells[0];
    const res = resolveTap(board, r, c);
    applyMatches(board, res.matches);
    applyGenerators(board, gens);
    alive -= res.matches.length;
  }
  const gensDone = gens.every((g) => g.queue.length === 0);
  return { solved: alive === 0 && countTiles(board) === 0 && gensDone, alive };
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

// Mekanik levelleri (levels_mekanik.js, dış format): yerleşim + çözüm.
// Generator'lı level sıradan bağımsız bittiğinden (bkz. board.js baş yorumu)
// tek greedy sim yeterli doğrulamadır; ayrıca ters sırada da denenir.
function simulateLast(lv) {
  const board = boardFromLevel(lv);
  const gens = cloneGenerators(lv.generators);
  let alive = lv.pairs.length, guard = 0;
  while (alive > 0 && guard++ < 500) {
    const cells = availableTapCells(board);
    if (cells.length === 0) return false;
    const { r, c } = cells[cells.length - 1];
    const res = resolveTap(board, r, c);
    applyMatches(board, res.matches);
    applyGenerators(board, gens);
    alive -= res.matches.length;
  }
  return alive === 0 && gens.every((g) => g.queue.length === 0);
}
for (const ext of TM_MECH_LEVELS) {
  const lv = levelFromExternal(ext, { id: ext.id });
  const issues = generatorIssues(lv);
  check("mekanik " + ext.id + ": yerleşim geçerli", issues.length === 0);
  if (issues.length) console.error("  → " + issues.join("; "));
  check("mekanik " + ext.id + ": sticker sayısı = çift sayısı",
    !ext.stickers || ext.stickers.length === lv.pairs.length);
  check("mekanik " + ext.id + ": bitişik hizalı çift yok",
    !lv.pairs.some((p) => p.length === 2 && isAdjacentCollinear(p)));
  const sim = simulate(lv);
  check("mekanik " + ext.id + ": çözülebilir (ilk açık)", sim.solved);
  if (!sim.solved) console.error("  → kalan çift: " + sim.alive);
  check("mekanik " + ext.id + ": çözülebilir (son açık)", simulateLast(lv));
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
