"use strict";

// Sticker paketini dış motor için dışa aktarır:
//   node tools/export_stickers.js → export_stickers/<sid>.png + stickers.json
//
// Level dosyaları (export_levels/*.json "stickers" alanı) sticker'lara sid
// ile referans verir; bu paket her sid'i AYNI ADLA png olarak taşır — oyun
// tarafında ek harita gerekmez, sid doğrudan dosya adıdır. stickers.json
// manifesti kategori/renk üstverisini taşır (tarif/analiz için).
//
// Kaynak: sticker_manager/catalog.json + sticker_manager/library/ (tek
// doğruluk kaynağı). Katalog değişince yeniden koş; klasör her koşuda
// sıfırdan kurulur (emekli sid'ler otomatik düşer).

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SM = path.join(ROOT, "sticker_manager");
const OUT = path.join(ROOT, "export_stickers");

const catalog = JSON.parse(fs.readFileSync(path.join(SM, "catalog.json"), "utf8"))
  .filter((r) => r.sid && r.src);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const manifest = [];
let missing = 0;
for (const r of catalog.sort((a, b) => (a.sid < b.sid ? -1 : 1))) {
  const src = path.join(SM, "library", r.src);
  if (!fs.existsSync(src)) {
    console.error("EKSİK görsel: " + r.src + " (" + r.sid + ")");
    missing++;
    continue;
  }
  fs.copyFileSync(src, path.join(OUT, r.sid + ".png"));
  manifest.push({ sid: r.sid, file: r.sid + ".png", category: r.cat, color: r.color });
}
if (missing) throw new Error(missing + " görsel eksik — paket yarım, dağıtma");

fs.writeFileSync(path.join(OUT, "stickers.json"),
  JSON.stringify({ count: manifest.length, stickers: manifest }, null, 1) + "\n");

// funnel kapsaması: level dosyalarının kullandığı her sid pakette mi?
const EXP = path.join(ROOT, "export_levels");
const inPack = new Set(manifest.map((m) => m.sid));
let usedN = 0, unknown = 0;
if (fs.existsSync(EXP)) {
  const usedSids = new Set();
  for (const f of fs.readdirSync(EXP)) {
    if (!/^\d+_[emh]\.json$/.test(f)) continue;
    const j = JSON.parse(fs.readFileSync(path.join(EXP, f), "utf8"));
    for (const s of j.stickers || []) {
      usedSids.add(s);
      if (!inPack.has(s)) { unknown++; console.error("levelda var pakette yok: " + s + " (" + f + ")"); }
    }
  }
  usedN = usedSids.size;
}
if (unknown) throw new Error(unknown + " sid pakette yok");

console.log("export_stickers/ yazıldı: " + manifest.length + " png + stickers.json" +
  (usedN ? " (funnel " + usedN + " farklı sid kullanıyor, hepsi pakette ✓)" : ""));
