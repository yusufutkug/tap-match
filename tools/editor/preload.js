"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("editorAPI", {
  loadLevels: () => ipcRenderer.invoke("levels:load"),
  computeEfforts: () => ipcRenderer.invoke("effort:compute"),
  onEffortProgress: (cb) =>
    ipcRenderer.on("effort:progress", (_e, p) => cb(p)),
  play: (no) => ipcRenderer.invoke("play", no),
  // manuel editör
  playCustom: (lv) => ipcRenderer.invoke("play:custom", lv),
  nextNo: () => ipcRenderer.invoke("level:nextNo"),
  saveLevel: (payload) => ipcRenderer.invoke("level:save", payload),
});
