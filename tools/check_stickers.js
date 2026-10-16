"use strict";

// Sticker atama denetçisi — assign_stickers.js çıktısını doğrular:
//   node tools/check_stickers.js
//   1. her levelda çift sayısı kadar BENZERSİZ ve katalogda var olan sid
//   2. yasaklı kategori çiftleri aynı levelda buluşmaz
//   3. level içi benzerlik: d < 0.19 çift asla; erken decade'lerde
//      (concave < 0.33) d < 0.23 de yasak (ayrışma rampası sözleşmesi)
//   4. mono/duo slotları (pos 6; pos 10 her 4. decade; yalnız ≤24 çift —
//      etiketli funnel'da (v3/v4) her decade'in generator'sız ilk e levelı)
//      renk sözleşmesine uyar
//   5. kapsama özeti: kategori/renk dağılımı, hiç kullanılmayan sticker sayısı

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
// TM_OUT=export_levels_v2 → başka funnel klasörü (v2: harfler t/e/m/h/vh)
const OUT = path.resolve(ROOT, process.env.TM_OUT || "export_levels");
const SM = path.join(ROOT, "sticker_manager");

const catalog = JSON.parse(fs.readFileSync(path.join(SM, "catalog.json"), "utf8"));
const bySid = new Map(catalog.map((r) => [r.sid, r]));
const simData = JSON.parse(fs.readFileSync(path.join(SM, "similar_pairs.json"), "utf8"));
const simKey = (a, b) => (a < b ? a + "|" + b : b + "|" + a);
const simD = new Map(simData.pairs.map(([a, b, d]) => [simKey(a, b), d]));

const FORBIDDEN = [
  ["gems", "shapes"], ["icons", "shapes"], ["icons", "gems"],
  ["cookie_words", "cat_words"],
];
const MONO_COLORS = ["red", "blue", "green", "yellow", "pink", "orange"];
const DECADES = 100;
const concave = (d) => {
  const t = DECADES > 1 ? d / (DECADES - 1) : 1;
  return 1 - (1 - t) * (1 - t);
};

const files = fs.readdirSync(OUT)
  .filter((f) => /^\d+_(t|e|m|h|vh)\.json$/.test(f))
  .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

let errors = 0;
const err = (msg) => { errors++; if (errors <= 30) console.log("HATA " + msg); };
const used = new Map();

// mono slot modu (assign_stickers ile aynı): etiketli funnel (vh var) →
// her decade'in (11+) generator'sız ilk e levelı (≤32 çift); yoksa pos kuralı.
const MONO_MODE = files.some((f) => /_vh\.json$/.test(f)) ? "label" : "pos";
const monoSet = new Set();
if (MONO_MODE === "label") {
  const seen = new Set();
  for (const f of files) {
    const no = parseInt(f, 10);
    if (no < 11) continue;
    const d = Math.floor((no - 1) / 10);
    if (seen.has(d) || !/_e\.json$/.test(f)) continue;
    const j = JSON.parse(fs.readFileSync(path.join(OUT, f), "utf8"));
    if ((j.TileGenerators && j.TileGenerators.length) || Math.max(0, ...j.cells) > 32) continue;
    seen.add(d); monoSet.add(no);
  }
}

for (const f of files) {
  const no = parseInt(f, 10);
  // funnel düzeni: 1-4 öğretici, 5-10 giriş, 11+ ana döngü (10 kaydırma).
  // Öğretici/giriş decade-0 gibi denetlenir; mono slotu yoktur.
  const fNo = Math.max(1, no - 10);
  const inCycle = no >= 11;
  const d = Math.floor((fNo - 1) / 10);
  const pos = ((fNo - 1) % 10) + 1;
  const j = JSON.parse(fs.readFileSync(path.join(OUT, f), "utf8"));
  const pairsN = Math.max(0, ...j.cells, ...(j.TileGenerators || []).flatMap((g) => g.Tiles));
  if (!Array.isArray(j.stickers)) { err(f + ": stickers yok"); continue; }
  if (j.stickers.length !== pairsN) err(f + ": " + j.stickers.length + " sid, " + pairsN + " çift");
  const set = new Set(j.stickers);
  if (set.size !== j.stickers.length) err(f + ": tekrar eden sid");
  const cats = new Set();
  const colors = new Map();
  for (const s of j.stickers) {
    const r = bySid.get(s);
    if (!r) { err(f + ": katalogda yok: " + s); continue; }
    cats.add(r.cat);
    colors.set(r.color, (colors.get(r.color) || 0) + 1);
    used.set(s, (used.get(s) || 0) + 1);
  }
  for (const [a, b] of FORBIDDEN) {
    if (cats.has(a) && cats.has(b)) err(f + ": yasaklı çift " + a + "+" + b);
  }
  // benzerlik: level içi tüm çiftler. Mono/duo slotlar erken-decade sıkı
  // eşiğinden muaftır (aynı-renk stickerlar metrikte doğal yakın; taban
  // 0.19 onlar için de mutlak yasak). Öğreticiler (1-4) elle seçilmiştir,
  // yalnız 0.19 tabanı denetlenir.
  // mono sözleşmesi yalnız küçük boardda (assign_stickers ile aynı sınır)
  const isMonoSlot = MONO_MODE === "label" ? monoSet.has(no)
    : inCycle && pairsN <= 24 && (pos === 6 || (pos === 10 && d % 4 === 3));
  const thr = no <= 4 ? 0.19 : !isMonoSlot && concave(d) < 0.33 ? 0.23 : 0.19;
  const list = j.stickers;
  for (let i = 0; i < list.length; i++) {
    for (let k = i + 1; k < list.length; k++) {
      const dd = simD.get(simKey(list[i], list[k]));
      if (dd !== undefined && dd < 0.19) {
        err(f + ": benzer çift d=" + dd + " " + list[i] + " ↔ " + list[k]);
      } else if (dd !== undefined && dd < thr) {
        err(f + ": erken decade benzer çift d=" + dd + " " + list[i] + " ↔ " + list[k]);
      }
    }
  }
  // mono/duo sözleşmesi
  if (isMonoSlot) {
    const kind = (MONO_MODE === "label" || pos === 6) && d % 3 === 2 ? "duo" : "mono";
    const n = colors.size;
    if (kind === "mono" && n !== 1) err(f + ": mono slot " + n + " renk");
    if (kind === "duo" && n !== 2) err(f + ": duo slot " + n + " renk");
    if (kind === "mono") {
      const want = MONO_COLORS[d % MONO_COLORS.length];
      if (![...colors.keys()][0] || [...colors.keys()][0] !== want) {
        err(f + ": mono renk " + [...colors.keys()][0] + " ≠ " + want);
      }
    }
  }
}

console.log(files.length + " level denetlendi — " +
  (errors ? errors + " HATA" : "temiz ✓"));
console.log("kullanılan farklı sticker: " + used.size + "/" + catalog.length);
const counts = [...used.values()].sort((a, b) => a - b);
if (counts.length) {
  console.log("kullanım: min " + counts[0] + " · medyan " +
    counts[Math.floor(counts.length / 2)] + " · maks " + counts[counts.length - 1]);
}
process.exit(errors ? 1 : 0);
