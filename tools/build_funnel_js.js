"use strict";

// Dış formatlı funnel klasörünü oyuna paket olarak gömer:
//   node tools/build_funnel_js.js
//     → levels_funnel.js : var TM_FUNNEL_PACKS = [{ size, name, levels: [ext…] }]
// Her paket bir klasör (funnel.csv sırası). Level dış formatta kalır
// (cells / stickers / TileGenerators); js/game.js levelFromExternal ile
// iç modele çevirir — Mekanikler bölümünde kart olarak listelenir.
// İlerleme anahtarı "<size>:<no>".
// Paket listesi PACKS'te; yeni funnel eklemek için satır ekle.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PACKS = [
  { dir: "export_levels_v3", size: "v3", name: "Generator funnel v3" },
];

const out = [];
for (const p of PACKS) {
  const dir = path.join(ROOT, p.dir);
  const order = fs.readFileSync(path.join(dir, "funnel.csv"), "utf8").trim().split(",");
  const levels = order.map((name) => {
    const j = JSON.parse(fs.readFileSync(path.join(dir, name + ".json"), "utf8"));
    const [no, label] = name.split("_");
    const ext = { id: parseInt(no, 10), name: label, width: j.width, height: j.height, cells: j.cells };
    if (j.stickers) ext.stickers = j.stickers;
    if (j.TileGenerators) ext.TileGenerators = j.TileGenerators;
    return ext;
  });
  out.push({ size: p.size, name: p.name, cols: 0, rows: 0, levels });
  console.log(p.dir + " → " + levels.length + " level");
}

const js =
  '"use strict";\n\n' +
  "// Üretilmiş funnel paketleri — ELLE DÜZENLEME; kaynak: export_levels_*/\n" +
  "// (dış motor formatı), yazan: tools/build_funnel_js.js.\n\n" +
  "var TM_FUNNEL_PACKS = " + JSON.stringify(out) + ";\n\n" +
  'if (typeof module !== "undefined") module.exports = { TM_FUNNEL_PACKS };\n';
fs.writeFileSync(path.join(ROOT, "levels_funnel.js"), js);
console.log("yazıldı: levels_funnel.js (" + (js.length / 1024).toFixed(0) + " KB)");
