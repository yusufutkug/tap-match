"use strict";

// Oyun penceresi preload'ı — sayfa scriptlerinden ÖNCE koşar: seçili levelı
// main'den alır ve oyunun lab kancasına (localStorage tm_lab_level, bkz.
// js/game.js ?lab=1 yolu) yazar.

const { ipcRenderer } = require("electron");

const lv = ipcRenderer.sendSync("play:get");
if (lv) {
  try {
    localStorage.setItem("tm_lab_level", JSON.stringify(lv));
  } catch (e) {
    console.error("tm_lab_level yazılamadı:", e);
  }
}
