"use strict";

// Tap Match board çekirdeği.
//
// Kural seti (v1):
// - Oyuncu BOŞ bir hücreye tap eder. Hücrenin 4 yönde gördüğü en yakın
//   taşlar hesaplanır (boş hücreler görüşü kesmez, taş keser) — en fazla 4 taş.
// - Gören taşlar arasında tam çift(ler) varsa: çift(ler) hücreye gelir,
//   çarpışıp kırılır. İki çift aynı anda görüyorsa ikisi de kırılır (combo).
//   Eşi olmayan gören taşlar yerinde kalır.
// - Hiç çift yoksa: gören taşlar hücreye gelir, kırılmadan geri döner (hata).
// - Her sticker levelda tam iki taşta görünür → hücre = çift indeksi.
//
// Yapısal garanti: taş kalkması görüşü yalnız açar ve boş hücre sayısını
// yalnız artırır (monotonluk) → açılan eşleşme bir daha kapanmaz; çözülebilir
// level HANGİ sırayla oynanırsa oynansın biter. Yapısal deadlock iki türlü:
// hizalı+bitişik (span-1) çift (hiç çözüm hücresi yok) ve karşılıklı kilit
// döngüleri (ör. çapraz kilit: iki hizasız çift birbirinin köşe hücrelerine
// oturur). Genel doğrulama js/flow.js'tedir (AND/OR dalga analizi ∞ dalga =
// deadlock; pairsCurve simülasyonu null = tıkalı).
//
// Tile Generator (engel): bir hücre kaplar, bir yöne bakar, kuyruğunda sıralı
// çift kimlikleri taşır. Aktifken ışını keser (taş gibi) ama hiçbir çiftle
// eşleşmez. Önündeki hücre boşaldığı an (öndeki taş eşleşince) kuyruktaki
// sıradaki taşı öne basar; son taşı bastığında kırılır, hücresi dot olur.
// Hücre değeri: null boş · 0+ çift kimliği · negatif = generator (-1 - idx).
// Monotonluk korunur: ön hücre generator yaşadığı sürece hiç boşalmadığından
// (taş kalkar, yerine yenisi gelir) açık bir görüş asla kapanmaz; dolayısıyla
// generator'lı level de sıradan bağımsız biter ya da yapısal olarak tıkalıdır.

const GEN_DIRS = { U: [-1, 0], D: [1, 0], L: [0, -1], R: [0, 1] };
// dış format Direction enum'u (0 yukarı, 1 aşağı, 2 sol, 3 sağ)
const GEN_DIR_CODES = ["U", "D", "L", "R"];

function isGen(v) { return v !== null && v < 0; }
function genIndexOf(v) { return -1 - v; }

function makeEmptyBoard(rows, cols) {
  return Array.from({ length: rows }, () => Array(cols).fill(null));
}

function cloneBoard(board) {
  return board.map((row) => row.slice());
}

// Boarddaki taş sayısı (generator hücreleri sayılmaz).
function countTiles(board) {
  let n = 0;
  for (const row of board) for (const cell of row) if (cell !== null && cell >= 0) n++;
  return n;
}

// Çift listesinden board türetilir (hücre = çift indeksi, kalanlar boş).
// Bir çiftin taşı generator kuyruğundaysa çift tek koordinatlı olabilir.
function boardFromPairs(rows, cols, pairs) {
  const board = makeEmptyBoard(rows, cols);
  pairs.forEach((pair, i) => {
    for (const [r, c] of pair) board[r][c] = i;
  });
  return board;
}

// Level → board: çiftler + generator hücreleri (negatif kimlik).
function boardFromLevel(lv) {
  const board = boardFromPairs(lv.rows, lv.cols, lv.pairs);
  (lv.generators || []).forEach((g, gi) => { board[g.r][g.c] = -1 - gi; });
  return board;
}

// Oynanış için kopya: kuyruklar tüketildiğinden level verisi bozulmasın.
function cloneGenerators(gens) {
  return (gens || []).map((g) => ({ r: g.r, c: g.c, dir: g.dir, queue: g.queue.slice() }));
}

// Generator'ın önündeki hücre.
function genFront(g) {
  const [dr, dc] = GEN_DIRS[g.dir];
  return [g.r + dr, g.c + dc];
}

// Eşleşme sonrası üretim adımı (yerinde mutasyon). Önü boşalan her aktif
// generator kuyruğundaki sıradaki taşı öne basar; kuyruğu biten kırılır.
// Dönüş: { spawned: [{ gen, r, c, pairId }], broken: [genIdx] } — görsel katman için.
function applyGenerators(board, gens) {
  const spawned = [], broken = [];
  if (!gens) return { spawned, broken };
  const rows = board.length, cols = board[0].length;
  gens.forEach((g, gi) => {
    if (g.queue.length === 0) return; // kırılmış
    const [fr, fc] = genFront(g);
    if (fr < 0 || fr >= rows || fc < 0 || fc >= cols) return;
    if (board[fr][fc] !== null) return; // önü dolu: bekle
    const pairId = g.queue.shift();
    board[fr][fc] = pairId;
    spawned.push({ gen: gi, r: fr, c: fc, pairId });
    if (g.queue.length === 0) { board[g.r][g.c] = null; broken.push(gi); }
  });
  return { spawned, broken };
}

// Generator yerleşiminin yapısal kontrolü. Dönüş: hata metinleri (boş = geçerli).
// Çözülebilirlik ayrıca simülasyonla doğrulanır (tools/test_board.js).
function generatorIssues(lv) {
  const out = [];
  const gens = lv.generators || [];
  const fronts = new Set();
  const onBoard = new Set();
  for (const pair of lv.pairs) for (const [r, c] of pair) onBoard.add(r + "," + c);
  gens.forEach((g, gi) => {
    const tag = "generator " + gi + ": ";
    if (!GEN_DIRS[g.dir]) { out.push(tag + "geçersiz yön " + g.dir); return; }
    if (g.r < 0 || g.r >= lv.rows || g.c < 0 || g.c >= lv.cols) out.push(tag + "board dışı");
    if (onBoard.has(g.r + "," + g.c)) out.push(tag + "hücresinde taş var");
    if (!g.queue || g.queue.length === 0) out.push(tag + "kuyruk boş");
    const [fr, fc] = genFront(g);
    if (fr < 0 || fr >= lv.rows || fc < 0 || fc >= lv.cols) out.push(tag + "önü board dışı");
    const fk = fr + "," + fc;
    if (fronts.has(fk)) out.push(tag + "ön hücre başka generator'la ortak");
    fronts.add(fk);
    if (gens.some((o) => o.r === fr && o.c === fc)) out.push(tag + "önü başka generator");
    else if (!onBoard.has(fk)) out.push(tag + "önü başlangıçta boş (tıpa taşı yok)");
    const seen = new Set();
    for (const pid of g.queue || []) {
      if (pid < 0 || pid >= lv.pairs.length) out.push(tag + "kuyrukta tanımsız çift " + pid);
      if (seen.has(pid)) out.push(tag + "aynı kuyrukta çiftin iki taşı (" + pid + ")");
      seen.add(pid);
    }
  });
  // her çift toplamda (board + kuyruklar) tam iki taş
  const cnt = lv.pairs.map((p) => p.length);
  for (const g of gens) for (const pid of g.queue || []) if (cnt[pid] !== undefined) cnt[pid]++;
  cnt.forEach((n, i) => { if (n !== 2) out.push("çift " + i + ": " + n + " taş (2 olmalı)"); });
  return out;
}

// Dış motor formatı → iç level. cells index 0 SOL ALT; 0 dot, n≥1 çift
// kimliği; TileGenerators: [{ Cell, Direction, Tiles }] (Tiles 1 tabanlı,
// üretim sırası). stickers[n-1] aynen taşınır (iç pairId = n-1).
function levelFromExternal(ext, meta) {
  const cols = ext.width, rows = ext.height;
  const toRC = (idx) => [rows - 1 - Math.floor(idx / cols), idx % cols];
  let maxId = 0;
  for (const v of ext.cells) if (v > maxId) maxId = v;
  for (const g of ext.TileGenerators || []) for (const t of g.Tiles) if (t > maxId) maxId = t;
  const pairs = Array.from({ length: maxId }, () => []);
  ext.cells.forEach((v, idx) => { if (v > 0) pairs[v - 1].push(toRC(idx)); });
  const generators = (ext.TileGenerators || []).map((g) => {
    const [r, c] = toRC(g.Cell);
    return { r, c, dir: GEN_DIR_CODES[g.Direction] || "D", queue: g.Tiles.map((t) => t - 1) };
  });
  const lv = Object.assign({ rows, cols, pairs }, meta || {});
  if (generators.length) lv.generators = generators;
  if (ext.stickers) lv.stickers = ext.stickers.slice();
  return lv;
}

const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]]; // yukarı, aşağı, sol, sağ

// (r,c) hücresinin 4 yönde gördüğü en yakın taşlar.
// Dönüş: [{ r, c, pairId }] (0-4 eleman). Generator hücresi de ışını keser ve
// listeye negatif pairId ile girer (eşleşme/bounce dışında tutmak çağıranın işi).
function visibleTilesFrom(board, r, c) {
  const rows = board.length, cols = board[0].length;
  const out = [];
  for (const [dr, dc] of DIRS) {
    let rr = r + dr, cc = c + dc;
    while (rr >= 0 && rr < rows && cc >= 0 && cc < cols) {
      const v = board[rr][cc];
      if (v !== null) { out.push({ r: rr, c: cc, pairId: v }); break; }
      rr += dr; cc += dc;
    }
  }
  return out;
}

// Tap'in sonucu (board'u DEĞİŞTİRMEZ).
// kind: "occupied" (dolu hücre) | "blank" (hiç taş görmüyor)
//     | "miss" (taş var ama çift yok → bounce) | "match" (çift(ler) kırılır)
// matches: [{ pairId, tiles: [[r,c],[r,c]] }] — 0, 1 ya da 2 çift.
// bounce: yalnız miss'te — gelip geri dönecek taşlar [[r,c], ...].
// Görülen generator'lar ne eşleşir ne bounce eder (yalnız ışını keserler);
// yalnız generator gören hücre "blank" sayılır.
function resolveTap(board, r, c) {
  if (board[r][c] !== null) return { kind: "occupied", matches: [], bounce: [] };
  const seen = visibleTilesFrom(board, r, c).filter((t) => t.pairId >= 0);
  if (seen.length === 0) return { kind: "blank", matches: [], bounce: [] };

  const byPair = new Map();
  for (const t of seen) {
    if (!byPair.has(t.pairId)) byPair.set(t.pairId, []);
    byPair.get(t.pairId).push([t.r, t.c]);
  }
  const matches = [];
  for (const [pairId, tiles] of byPair) {
    if (tiles.length === 2) matches.push({ pairId, tiles });
  }
  if (matches.length > 0) return { kind: "match", matches, bounce: [] };
  return { kind: "miss", matches: [], bounce: seen.map((t) => [t.r, t.c]) };
}

// Match sonucunu board'a uygular (yerinde mutasyon).
function applyMatches(board, matches) {
  for (const m of matches) {
    for (const [r, c] of m.tiles) board[r][c] = null;
  }
}

// Şu an tap'lenince eşleşme üreten tüm boş hücreler.
// Dönüş: [{ r, c, pairIds }] — pairIds o hücreden kırılacak çiftler.
function availableTapCells(board) {
  const out = [];
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[0].length; c++) {
      if (board[r][c] !== null) continue;
      const res = resolveTap(board, r, c);
      if (res.kind === "match") {
        out.push({ r, c, pairIds: res.matches.map((m) => m.pairId) });
      }
    }
  }
  return out;
}

// Şu an eşleşebilir çiftlerin kümesi (istatistik/hint için).
function matchablePairs(board) {
  const set = new Set();
  for (const cell of availableTapCells(board)) {
    for (const id of cell.pairIds) set.add(id);
  }
  return set;
}

// Hizalı + bitişik çift mi? (yapısal deadlock — level doğrulamada kullanılır)
function isAdjacentCollinear([[r1, c1], [r2, c2]]) {
  return (r1 === r2 && Math.abs(c1 - c2) === 1) ||
         (c1 === c2 && Math.abs(r1 - r2) === 1);
}

if (typeof module !== "undefined") {
  module.exports = {
    makeEmptyBoard, cloneBoard, countTiles, boardFromPairs,
    visibleTilesFrom, resolveTap, applyMatches,
    availableTapCells, matchablePairs, isAdjacentCollinear,
    // Tile Generator
    GEN_DIRS, GEN_DIR_CODES, isGen, genIndexOf, boardFromLevel, cloneGenerators,
    genFront, applyGenerators, generatorIssues, levelFromExternal,
  };
}
