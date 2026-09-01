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

function makeEmptyBoard(rows, cols) {
  return Array.from({ length: rows }, () => Array(cols).fill(null));
}

function cloneBoard(board) {
  return board.map((row) => row.slice());
}

function countTiles(board) {
  let n = 0;
  for (const row of board) for (const cell of row) if (cell !== null) n++;
  return n;
}

// Çift listesinden board türetilir (hücre = çift indeksi, kalanlar boş).
function boardFromPairs(rows, cols, pairs) {
  const board = makeEmptyBoard(rows, cols);
  pairs.forEach(([[r1, c1], [r2, c2]], i) => {
    board[r1][c1] = i;
    board[r2][c2] = i;
  });
  return board;
}

const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]]; // yukarı, aşağı, sol, sağ

// (r,c) hücresinin 4 yönde gördüğü en yakın taşlar.
// Dönüş: [{ r, c, pairId }] (0-4 eleman).
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
function resolveTap(board, r, c) {
  if (board[r][c] !== null) return { kind: "occupied", matches: [], bounce: [] };
  const seen = visibleTilesFrom(board, r, c);
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
  };
}
