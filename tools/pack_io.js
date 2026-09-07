"use strict";

// Paket yazıcı — üreticilerin zengin level çıktısını iki hedefe yazar:
//
//   levels/<size>/pack.json   paket künyesi: { format, size, cols, rows
//                             [, full], count }
//   levels/<size>/NNN.json    her level AYRI dosya: { id, diff, pairs }
//   ../<base>.js              toplu script-tag sarmalayıcısı — oyun file://
//                             ile açıldığında fetch çalışmadığı için
//                             index.html bunu yükler; içerik levels/
//                             ağacıyla birebir (test_generator.js doğrular)
//
// Level şeması (tapmatch-pack@1) — README "Level JSON formatı":
//   id    1..count (dosya adı = 3 haneli id)
//   diff  easy|medium|hard|veryhard — level kartı rengi
//   pairs FIFO kanonik oynanış sırasında [[r,c],[r,c]] çiftleri
// rows/cols level'a yazılmaz (pack.json'dan gelir); seed yazılmaz (emoji
// karışımı js/game.js'te "size:id"den türetilir); level adı ve üretim
// metrikleri tutulmaz.

const fs = require("fs");
const path = require("path");

const FORMAT = "tapmatch-pack@1";
const LEVELS_DIR = path.join(__dirname, "..", "levels");

const fileOf = (id) => String(id).padStart(3, "0") + ".json";

// zengin üretici çıktısı → runtime çekirdeği
function trimLevel(lv) {
  return { id: lv.id, diff: lv.diff || (lv.meta && lv.meta.label), pairs: lv.pairs };
}

// opts: { packs, base, globalName, header }
function writePacks(opts) {
  const dataPacks = [];
  for (const pk of opts.packs) {
    const dir = path.join(LEVELS_DIR, pk.size);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    const dp = { size: pk.size, cols: pk.cols, rows: pk.rows };
    if (pk.full) dp.full = true;
    dp.levels = pk.levels.map(trimLevel);

    const info = { format: FORMAT, size: pk.size, cols: pk.cols, rows: pk.rows };
    if (pk.full) info.full = true;
    info.count = dp.levels.length;
    fs.writeFileSync(path.join(dir, "pack.json"), JSON.stringify(info) + "\n");
    for (const lv of dp.levels) {
      fs.writeFileSync(path.join(dir, fileOf(lv.id)), JSON.stringify(lv) + "\n");
    }
    dataPacks.push(dp);
  }

  const js =
    '"use strict";\n\n' + opts.header +
    "var " + opts.globalName + " = " + JSON.stringify(dataPacks) + ";\n\n" +
    'if (typeof module !== "undefined") module.exports = { ' +
    opts.globalName + " };\n";
  fs.writeFileSync(path.join(__dirname, "..", opts.base + ".js"), js);

  return { packsN: dataPacks.length, jsKb: Math.round(js.length / 1024) };
}

// levels/<size>/ ağacını sarmalayıcıyla aynı yapıda geri okur (testler için)
function readPack(size) {
  const dir = path.join(LEVELS_DIR, size);
  const info = JSON.parse(fs.readFileSync(path.join(dir, "pack.json")));
  const pk = { size: info.size, cols: info.cols, rows: info.rows };
  if (info.full) pk.full = true;
  pk.levels = [];
  for (let id = 1; id <= info.count; id++) {
    pk.levels.push(JSON.parse(fs.readFileSync(path.join(dir, fileOf(id)))));
  }
  return pk;
}

module.exports = { writePacks, readPack, FORMAT };
