"use strict";

// Sticker kimlik haritası üretir:
//   node tools/gen_sticker_map.js → stickers_map.js (kök)
//
// Kaynak: sticker_manager/catalog.json (tek doğruluk kaynağı — sid'ler
// orada basılır, bkz. sticker_manager/README.md "sid" bölümü). Oyun
// file:// ile açıldığında fetch çalışmadığı için harita script-tag
// sarmalayıcı olarak taşınır: TM_STICKERS[sid] = kütüphane içi görsel yolu
// ("kategori/dosya.png"; kök: sticker_manager/library/).
//
// Level dosyaları sticker'lara SADECE sid ile referans verir; dosya adı
// değişse bile (yeniden import vb.) haritayı yeniden üretmek yeter.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const catalog = JSON.parse(
  fs.readFileSync(path.join(ROOT, "sticker_manager", "catalog.json"), "utf8"));

const entries = catalog
  .filter((r) => r.sid && r.src)
  .sort((a, b) => (a.sid < b.sid ? -1 : a.sid > b.sid ? 1 : 0));

const dupes = new Set();
const seen = new Set();
for (const e of entries) {
  if (seen.has(e.sid)) dupes.add(e.sid);
  seen.add(e.sid);
}
if (dupes.size) throw new Error("çift sid: " + [...dupes].join(", "));

const body = entries
  .map((e) => JSON.stringify(e.sid) + ": " + JSON.stringify(e.src))
  .join(",\n  ");

fs.writeFileSync(
  path.join(ROOT, "stickers_map.js"),
  "// Üretilmiş sid → görsel yolu haritası — ELLE DÜZENLEME; kaynak:\n" +
  "// sticker_manager/catalog.json, yazan: tools/gen_sticker_map.js.\n" +
  "// Görsel kökü: sticker_manager/library/\n" +
  '"use strict";\n\n' +
  "var TM_STICKERS = {\n  " + body + "\n};\n\n" +
  'if (typeof module !== "undefined") module.exports = { TM_STICKERS };\n');

console.log("stickers_map.js yazıldı: " + entries.length + " sid");
