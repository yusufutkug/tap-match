"use strict";

// En zor hamleler raporu — tarama (sweep) efor botuyla (js/flow.js
// boardSweep; --salience ile oran modeli) her level oynanır; boyut başına
// botun OYNAMAK ZORUNDA kaldığı en yüksek eforlu 10 hamle (tek level
// listeyi doldurmasın diye level başına en fazla 2), hamle anındaki board
// + BİR ÖNCEKİ hamlenin boardu yan yana, kökteki hard_moves.html'e yazılır
// (üretilen dosya, elle düzenleme). Sweep'te önceki hamlenin tap'i aynı
// zamanda taramanın başlangıcıdır (zor boardda mavi halka).
//
// Çalıştırma:
//   node tools/report_hard_moves.js              # tüm paketler (sweep)
//   node tools/report_hard_moves.js --salience   # oran modeli
//   TM_SIZES=6x8 node tools/report_hard_moves.js

const fs = require("fs");
const path = require("path");
const { readPack } = require("./pack_io.js");
const { boardFromPairs } = require("../js/board.js");
const { boardSalience, boardSweep, scanBoard } = require("../js/flow.js");

const MODEL = process.argv.includes("--salience") ? "salience" : "sweep";

const LEVELS_DIR = path.join(__dirname, "..", "levels");
const allSizes = fs.readdirSync(LEVELS_DIR).filter((d) =>
  fs.existsSync(path.join(LEVELS_DIR, d, "pack.json")));
const sizes = process.env.TM_SIZES
  ? process.env.TM_SIZES.split(",").map((s) => s.trim()).filter(Boolean)
  : allSizes.sort();

const KEEP = 40, TOP = 10, PER_LEVEL = 2;

// Botla tek level: her adımın eforu + hamle ÖNCESİ board kopyası + önceki
// adımın referansı (rapor kartında bağlam olarak çizilir).
function playLevel(lv, rows, cols) {
  const board = boardFromPairs(rows, cols, lv.pairs);
  let alive = lv.pairs.length, step = 0, last = null, prev = null;
  const entries = [];
  while (alive > 0) {
    const ef = MODEL === "sweep"
      ? boardSweep(board, lv.pairs, last)
      : boardSalience(board, lv.pairs);
    if (!ef) return null; // olmamalı — leveller üretimde doğrulanır
    let pick = null, pickKey = Infinity;
    for (const cell of ef.cells) {
      const key = cell.r * cols + cell.c;
      if (!pick || cell.effort < pick.effort - 1e-9 ||
          (Math.abs(cell.effort - pick.effort) <= 1e-9 && key < pickKey)) {
        pick = cell; pickKey = key;
      }
    }
    const entry = {
      lvId: lv.id, diff: lv.diff, stepIdx: step,
      effort: pick.effort, searchPts: ef.searchPts,
      move: { r: pick.r, c: pick.c, pairIds: pick.pairIds.slice() },
      board: board.map((row) => row.slice()),
      pairs: lv.pairs,
      prev, // { board, move, effort } | null — sweep başlangıcı = prev.move
    };
    entries.push(entry);
    prev = { board: entry.board, move: entry.move, effort: entry.effort };
    for (const pid of pick.pairIds) {
      const [[r1, c1], [r2, c2]] = lv.pairs[pid];
      board[r1][c1] = null;
      board[r2][c2] = null;
    }
    alive -= pick.pairIds.length;
    last = [pick.r, pick.c];
    step++;
  }
  for (const e of entries) e.steps = step;
  return entries;
}

// Tek board ızgarası. Renkler: gri taş, turuncu kırılan çiftin taşları,
// mor tap, yeşil aynı çifti kıran diğer hücreler, mavi tarama başlangıcı.
function miniBoard(board, pairs, move, cols, rows, px, startCell) {
  const scan = scanBoard(board);
  const matchCells = new Set();
  for (const pid of move.pairIds) {
    for (const [r, c] of (scan.openOf.get(pid) || [])) matchCells.add(r + "," + c);
  }
  const pairTiles = new Set();
  for (const pid of move.pairIds) {
    for (const [r, c] of pairs[pid]) pairTiles.add(r + "," + c);
  }
  const startKey = startCell ? startCell[0] + "," + startCell[1] : null;
  let cells = "";
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = r + "," + c;
      let cls = "c";
      if (board[r][c] !== null) cls += pairTiles.has(k) ? " pt" : " t";
      else if (move.r === r && move.c === c) cls += " tap";
      else if (matchCells.has(k)) cls += " mc";
      if (k === startKey && !(move.r === r && move.c === c)) cls += " st";
      cells += '<i class="' + cls + '"></i>';
    }
  }
  return '<div class="bd" style="grid-template-columns:repeat(' + cols + "," + px +
    "px);grid-auto-rows:" + px + 'px">' + cells + "</div>";
}

// Kart: önceki hamle (bağlam) + zor hamle yan yana.
function boardCard(e, cols, rows) {
  const px = Math.max(9, Math.min(16, Math.floor(260 / Math.max(cols, rows))));
  const start = MODEL === "sweep" && e.prev ? [e.prev.move.r, e.prev.move.c] : null;
  let boards = "";
  if (e.prev) {
    boards += '<div class="half"><small>önceki hamle · efor ' +
      e.prev.effort.toFixed(0) + "</small>" +
      miniBoard(e.prev.board, e.pairs, e.prev.move, cols, rows, px, null) + "</div>";
  } else {
    boards += '<div class="half"><small>ilk hamle (öncesi yok' +
      (MODEL === "sweep" ? "; tarama merkezden" : "") + ")</small></div>";
  }
  boards += '<div class="half"><small>zor hamle · efor <b>' + e.effort.toFixed(0) +
    "</b></small>" + miniBoard(e.board, e.pairs, e.move, cols, rows, px, start) + "</div>";
  return '<div class="card"><div class="cap"><b>lv ' + e.lvId + "</b> · " + e.diff +
    " · adım " + (e.stepIdx + 1) + "/" + e.steps +
    " · efor <b>" + e.effort.toFixed(0) + "</b> <small>(havuz " + e.searchPts +
    ')</small></div><div class="boards">' + boards + "</div></div>";
}

const t0 = Date.now();
let html =
  '<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8">' +
  "<title>Tap Match — en zor hamleler (" + MODEL + ")</title><style>" +
  "body{font:14px/1.5 -apple-system,system-ui,sans-serif;background:#f5f2ec;color:#2c2a26;padding:24px;max-width:1240px;margin:0 auto}" +
  "h1{font-size:20px}h1 small{color:#8a857c;font-weight:500}" +
  "h2{margin:28px 0 10px;font-size:16px}h2 small{color:#8a857c;font-weight:500}" +
  "p{color:#57534b;font-size:13px;max-width:860px}" +
  ".legend{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:#6b665e;margin:10px 0 6px}" +
  ".legend i{display:inline-block;width:12px;height:12px;border-radius:3px;vertical-align:-2px;margin-right:5px}" +
  ".grid{display:flex;flex-wrap:wrap;gap:14px}" +
  ".card{background:#fffdf9;border:1px solid #e4ddd0;border-radius:10px;padding:10px}" +
  ".cap{font-size:12px;margin-bottom:8px}.cap small{color:#8a857c}" +
  ".boards{display:flex;gap:10px;align-items:flex-end}" +
  ".half small{display:block;color:#8a857c;font-size:11px;margin-bottom:4px}" +
  ".bd{display:grid;gap:1px;background:#eee7db;border:1px solid #eee7db;width:max-content}" +
  ".c{background:#faf7f1}" +
  ".c.t{background:#a8a29a;border-radius:2px}" +
  ".c.pt{background:#e2725b;border-radius:2px}" +
  ".c.tap{background:#f3ecff;outline:2px solid #8b5cf6;outline-offset:-2px;border-radius:2px}" +
  ".c.mc{background:#e2f7ec;box-shadow:inset 0 0 0 1.5px #34d399;border-radius:2px}" +
  ".c.st{box-shadow:inset 0 0 0 2px #3b82f6;border-radius:2px}" +
  "</style></head><body>" +
  "<h1>Tap Match — boyut başına en zor 10 hamle <small>(" +
  (MODEL === "sweep" ? "tarama/sweep eforu" : "salience eforu") + ")</small></h1>" +
  "<p>" + (MODEL === "sweep"
    ? "Tarama botu her adımda son tap'ten halka halka süpürüp İLK bulduğu match'i oynayarak " +
      "tüm levelleri bitirdi; efor = o hamleyi bulana dek geçilen search point sayısı. Aşağıda " +
      "her boyutta en pahalı 10 keşif, solda bir önceki hamleyle (taramanın başladığı yer)."
    : "Salience botu her adımda en ucuz hamleyi oynadı; efor = toplam search point / hamlenin " +
      "match point sayısı. Solda bir önceki hamle bağlam olarak.") + "</p>" +
  '<div class="legend">' +
  '<span><i style="background:#a8a29a"></i>taş</span>' +
  '<span><i style="background:#e2725b"></i>kırılan çiftin taşları</span>' +
  '<span><i style="background:#f3ecff;outline:2px solid #8b5cf6"></i>botun tap\'i</span>' +
  '<span><i style="background:#e2f7ec;box-shadow:inset 0 0 0 1.5px #34d399"></i>aynı çifti kıran diğer hücreler</span>' +
  (MODEL === "sweep"
    ? '<span><i style="box-shadow:inset 0 0 0 2px #3b82f6"></i>tarama başlangıcı (önceki tap)</span>'
    : "") +
  "</div>";

const summary = [];
for (const size of sizes) {
  const pk = readPack(size);
  let top = [];
  for (const lv of pk.levels) {
    const es = playLevel(lv, pk.rows, pk.cols);
    if (!es) { console.error("TIKALI: " + size + " #" + lv.id); continue; }
    top = top.concat(es).sort((a, b) => b.effort - a.effort).slice(0, KEEP);
  }
  const picked = [], cnt = new Map();
  for (const e of top) {
    const n = cnt.get(e.lvId) || 0;
    if (n >= PER_LEVEL) continue;
    cnt.set(e.lvId, n + 1);
    picked.push(e);
    if (picked.length >= TOP) break;
  }
  summary.push(
    size.padEnd(11) + "maks " + picked[0].effort.toFixed(0).padStart(5) +
    " (lv " + picked[0].lvId + ", adım " + (picked[0].stepIdx + 1) + "/" + picked[0].steps + ")" +
    " · 10. " + picked[picked.length - 1].effort.toFixed(0));
  html += "<h2>" + size + " <small>" + pk.cols + "×" + pk.rows +
    (pk.full ? " · tam dolu" : "") + "</small></h2>" +
    '<div class="grid">' + picked.map((e) => boardCard(e, pk.cols, pk.rows)).join("") + "</div>";
}
html += "</body></html>";

const out = path.join(__dirname, "..", "hard_moves.html");
fs.writeFileSync(out, html);
console.log("model: " + MODEL + "\n" + summary.join("\n"));
console.log("\nhard_moves.html yazıldı — " + sizes.length + " paket, " +
  ((Date.now() - t0) / 1000).toFixed(1) + " sn");
