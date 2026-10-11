"use strict";

// Tap Match level editör — Electron main process.
//
//   cd tools/editor && npm install && npm start
//
// export_levels/ içindeki tüm levelları okur (funnel numarası sırasıyla),
// eforlarını js/flow.js effortCurve(…, "sweep") ile ölçer (funnel'ı dizen
// metrikle AYNI — bkz. tools/export_levels.js) ve editor.html'e servis eder.
// "Oyna": level oyunun lab kancasıyla (index.html?lab=1 + localStorage
// tm_lab_level, bkz. js/game.js) ayrı pencerede başlatılır.

const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const EXPORT_DIR = path.join(ROOT, "export_levels");
const CACHE_FILE = path.join(__dirname, "effort_cache.json");
const { effortCurve } = require(path.join(ROOT, "js", "flow.js"));

let levels = null; // funnel sırasında: [{no, diff, file, width, height, pairs, mtime}]
let playLevel = null; // oyna penceresi preload'ı sendSync ile alır

// Dış format → iç çiftler. cells index 0 = SOL ALT, satır satır yukarı;
// 0 = boş, 1+ = çift kimliği (her kimlik tam iki hücrede). İç temsil r=0
// üst satır: r = height-1-floor(i/width), c = i%width.
function pairsFromCells(width, height, cells) {
  const byId = new Map();
  cells.forEach((v, i) => {
    if (v <= 0) return;
    const r = height - 1 - Math.floor(i / width);
    const c = i % width;
    if (!byId.has(v)) byId.set(v, []);
    byId.get(v).push([r, c]);
  });
  return [...byId.keys()].sort((a, b) => a - b).map((id) => byId.get(id));
}

function loadLevels() {
  const files = fs.readdirSync(EXPORT_DIR)
    .filter((f) => /^\d+_[emh]\.json$/.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  levels = files.map((f) => {
    const j = JSON.parse(fs.readFileSync(path.join(EXPORT_DIR, f), "utf8"));
    const st = fs.statSync(path.join(EXPORT_DIR, f));
    return {
      no: parseInt(f, 10),
      diff: f.match(/_([emh])\.json$/)[1],
      file: f,
      width: j.width,
      height: j.height,
      pairs: pairsFromCells(j.width, j.height, j.cells),
      // sticker ataması (tools/assign_stickers.js yazar): stickers[i] =
      // cells'teki (i+1) kimliğinin sid'i — pairsFromCells id sırasıyla
      // döndürdüğü için pairs[i] ile hizalı
      stickers: Array.isArray(j.stickers) ? j.stickers : null,
      mtime: st.mtimeMs,
    };
  });
  return levels;
}

ipcMain.handle("levels:load", () => loadLevels());

// Efor hesabı — dosya adı+mtime anahtarlı cache; yalnız değişen dosyalar
// yeniden ölçülür. Aralıklı setImmediate ile main loop tıkanmaz, progress
// event'i UI'a akar.
ipcMain.handle("effort:compute", async (e) => {
  if (!levels) loadLevels();
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); } catch (_) {}
  const out = {};
  const total = levels.length;
  let done = 0;
  for (const lv of levels) {
    const key = lv.file + ":" + lv.mtime;
    let ent = cache[lv.file];
    if (!ent || ent.key !== key) {
      const ec = effortCurve(lv.pairs, lv.height, lv.width, null, "sweep");
      ent = ec
        ? { key, mean: ec.effortMean, max: ec.effortMax, maxPos: ec.effortMaxPos,
            hiShare: ec.effortHiShare, curve: ec.effort }
        : { key, mean: null }; // tıkalı level (olmamalı)
      cache[lv.file] = ent;
    }
    out[lv.no] = ent;
    done++;
    if (done % 10 === 0 || done === total) {
      e.sender.send("effort:progress", { done, total });
      await new Promise((r) => setImmediate(r));
    }
  }
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
  return out;
});

// Oyna — level bellekte tutulur, oyun penceresinin preload'ı (play_preload)
// sayfa scriptlerinden ÖNCE sendSync ile alıp localStorage'a yazar.
ipcMain.on("play:get", (e) => { e.returnValue = playLevel; });

function openPlayWindow(title) {
  const win = new BrowserWindow({
    width: 480,
    height: 960,
    title,
    webPreferences: {
      preload: path.join(__dirname, "play_preload.js"),
      contextIsolation: true,
      sandbox: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(ROOT, "index.html"), { query: { lab: "1" } });
}

ipcMain.handle("play", (e, no) => {
  if (!levels) loadLevels();
  const lv = levels.find((l) => l.no === no);
  if (!lv) return false;
  playLevel = {
    name: "Funnel #" + no + " · " + lv.diff,
    rows: lv.height,
    cols: lv.width,
    pairs: lv.pairs,
    stickers: lv.stickers, // sid listesi (varsa oyun sticker basar)
    seed: (no * 2654435761) >>> 0, // deterministik emoji karışımı
  };
  openPlayWindow("Tap Match — #" + no);
  return true;
});

// ── manuel editör (edit.js) IPC'leri ──

// Kaydedilmemiş taslağı doğrudan oynat.
ipcMain.handle("play:custom", (e, lv) => {
  playLevel = {
    name: lv.name || "Editör denemesi",
    rows: lv.height,
    cols: lv.width,
    pairs: lv.pairs,
    seed: Date.now() >>> 0,
  };
  openPlayWindow("Tap Match — editör denemesi");
  return true;
});

// Bir sonraki boş funnel numarası (yeni level önerisi).
ipcMain.handle("level:nextNo", () => {
  const nos = fs.readdirSync(EXPORT_DIR)
    .map((f) => f.match(/^(\d+)_[emh]\.json$/))
    .filter(Boolean)
    .map((m) => parseInt(m[1], 10));
  return nos.length ? Math.max(...nos) + 1 : 1;
});

// Kaydet — tools/export_levels.js ile AYNI yazım: 0 = boş, 1+ = çift
// kimliği, cells'in ilk satırı boardun ALTI. Aynı numaralı dosya (farklı
// zorluk eki dahil) varsa önce {exists} döner; overwrite ile eskiler silinir.
// NOT: manuel kayıt stickers alanını TAŞIMAZ (çift kimlikleri elle düzenlemede
// yeniden dizilir, eski sid hizası sessizce yanlış olurdu) — geometri
// değiştiyse tools/assign_stickers.js yeniden koşulmalı.
ipcMain.handle("level:save", (e, { no, diff, width, height, pairs, overwrite }) => {
  const existing = fs.readdirSync(EXPORT_DIR).filter((f) => {
    const m = f.match(/^(\d+)_[emh]\.json$/);
    return m && parseInt(m[1], 10) === no;
  });
  if (existing.length && !overwrite) return { exists: existing.join(", ") };
  for (const f of existing) fs.unlinkSync(path.join(EXPORT_DIR, f));

  const cells = new Array(width * height).fill(0);
  pairs.forEach((pair, pi) => {
    for (const [r, c] of pair) cells[(height - 1 - r) * width + c] = pi + 1;
  });
  const w = String(pairs.length).length + 1;
  const rowsTxt = [];
  for (let rr = 0; rr < height; rr++) {
    rowsTxt.push("    " + cells.slice(rr * width, (rr + 1) * width)
      .map((v) => String(v).padStart(w)).join(","));
  }
  const json =
    "{\n" +
    '  "width": ' + width + ",\n" +
    '  "height": ' + height + ",\n" +
    '  "cells": [\n' + rowsTxt.join(",\n") + "\n  ]\n}\n";
  const file = no + "_" + diff + ".json";
  fs.writeFileSync(path.join(EXPORT_DIR, file), json);

  // funnel.csv güncel kalsın (export_levels.js ile aynı içerik)
  const all = fs.readdirSync(EXPORT_DIR)
    .filter((f) => /^\d+_[emh]\.json$/.test(f))
    .map((f) => f.replace(".json", ""))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  fs.writeFileSync(path.join(EXPORT_DIR, "funnel.csv"), all.join(",") + "\n");

  levels = null; // sonraki levels:load taze okur
  return { saved: file };
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    title: "Tap Match — Level Editör",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "editor.html"));
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
