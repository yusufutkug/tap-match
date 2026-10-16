"use strict";

// Sticker tarif motoru — funnel levellarına sid atar:
//   node tools/assign_stickers.js → export_levels/<n>_<x>.json dosyalarına
//   "stickers" alanı yazılır (stickers[i] = cells'teki i+1 kimliğinin sid'i).
//
// Geometriden TAMAMEN AYRI geçittir: level üretimi/exportu sticker bilmez,
// bu araç funnel sırasını okuyup tarifleri basar — sticker akışı level
// yeniden üretilmeden istendiği kadar revize edilir. Deterministik
// (level no → seed).
//
// Tarif kuralları (sticker_manager/README "Kategori öğrenimleri" +
// plan kararları):
//   tanıtım    kategoriler decade'lere yayılarak açılır (INTRO_ORDER);
//              yeni kategori açıldığı decade'de pos 1/2 levelında ağırlıklı
//              tanıtılır (~yarı çiftler yeni kategoriden).
//   mono/duo   pos 6 her decade tek/iki renk levelıdır (rotasyon: 2 mono +
//              1 duo); pos 10 her 4. decade ekstra mono (en ucuz slot —
//              "kesin kolay"). Yalnız güvenli renkler (120+ sticker) ve
//              ≤24 çift — daha büyük board normal karışıma düşer.
//              Etiketli funnel'larda (vh harfi var: v3/v4) pozisyon yerine
//              ETİKET: her decade'in (11+) generator'sız ilk e levelı mono/
//              duo (≤32 çift) — döngü "m e h e vh …" olduğundan pos 6 hep
//              m/7x10'a düşüyordu ve mono hiç çıkmıyordu.
//   akış       tema kategorileri decade + pozisyonla döner; favori
//              kategoriler (FAVS) periyodik ağırlık kazanır — "güzel
//              stickerlar bazen karışır bazen artar".
//   ayrışma    erken decade geniş renk yelpazesi (renk kotası) + sıkı
//              benzerlik eşiği (d<0.23 yasak); geç decade eşik 0.19'a iner,
//              renk kotası gevşer — algısal zorluk rampası.
//   uyumluluk  gems↔shapes, icons↔shapes/gems, fairytale↔fruits aynı
//              levelda asla (README desen 3 + yeni kategori notları);
//              benzer siluet çiftleri similar_pairs.json'dan (aynı metrik
//              temizlik turlarındakiyle: 24×24 RMS).

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
// TM_OUT=export_levels_v2 → başka funnel klasörü (v2: harfler t/e/m/h/vh)
const OUT = path.resolve(ROOT, process.env.TM_OUT || "export_levels");
const SM = path.join(ROOT, "sticker_manager");
const FILE_RE = /^\d+_(t|e|m|h|vh)\.json$/;

// ── veri ──
const catalog = JSON.parse(fs.readFileSync(path.join(SM, "catalog.json"), "utf8"))
  .filter((r) => r.sid);
const simData = JSON.parse(fs.readFileSync(path.join(SM, "similar_pairs.json"), "utf8"));
const bySid = new Map(catalog.map((r) => [r.sid, r]));

// benzerlik: sid → [{sid, d}] (iki yönlü)
const simOf = new Map();
for (const [a, b, d] of simData.pairs) {
  if (!simOf.has(a)) simOf.set(a, []);
  if (!simOf.has(b)) simOf.set(b, []);
  simOf.get(a).push({ sid: b, d });
  simOf.get(b).push({ sid: a, d });
}

// ── tarif sabitleri ──

// Kategori tanıtım sırası = tasarımcının öncelik listesi (2026-10-16,
// new_stickers_1610 seti; 41 kategori, katalogla birebir). Önde gelenler
// funnel'ın başında açılır ve en çok görünür.
const INTRO_ORDER = [
  "fruits", "flowers", "animals", "candy", "vegetables", "toys",   // decade 0 açık
  "under_sea", "numbers", "clothes", "desserts", "icons", "hats",
  "fantasy", "school", "shapes", "bags", "cookie_words", "countrylife",
  "sports", "breakfast", "gems", "weather", "music", "cleaning_items",
  "landmarks", "cat_words", "kitchen", "art_tools", "cold_drink", "space",
  "carnival", "christmas", "cinema", "world_cuisine", "bedroom", "camping",
  "baby_items", "dinosaurs", "halloween", "robots", "monsters",
];
const START_OPEN = 6;  // decade 0'da açık kategori sayısı
const PER_DECADE = 2;  // decade başına yeni kategori (bitene dek, ~decade 18)

// aynı levelda ASLA buluşmayacak kategori çiftleri
const FORBIDDEN = [
  ["gems", "shapes"], ["icons", "shapes"], ["icons", "gems"],
  ["cookie_words", "cat_words"], // iki kelime seti bir arada okunmaz
];
const forbiddenWith = new Map();
for (const [a, b] of FORBIDDEN) {
  if (!forbiddenWith.has(a)) forbiddenWith.set(a, new Set());
  if (!forbiddenWith.has(b)) forbiddenWith.set(b, new Set());
  forbiddenWith.get(a).add(b);
  forbiddenWith.get(b).add(a);
}

// tek/iki renk levelları için güvenli renkler (120+ sticker)
const MONO_COLORS = ["red", "blue", "green", "yellow", "pink", "orange"];
const DUO_COLORS = [
  ["yellow", "blue"], ["red", "white"], ["green", "pink"],
  ["orange", "blue"], ["red", "green"], ["pink", "blue"],
];

// favori kategoriler — periyodik ağırlık artışı
const FAVS = ["fruits", "flowers", "animals", "candy", "toys", "under_sea"];

const DECADES = 100;
const concave = (d) => {
  const t = Math.min(1, DECADES > 1 ? d / (DECADES - 1) : 1); // 1000+ level: rampa sonunda sabit
  return 1 - (1 - t) * (1 - t);
};

// ── yardımcılar ──
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const shuffle = (arr, rng) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const openCats = (d) =>
  new Set(INTRO_ORDER.slice(0, Math.min(INTRO_ORDER.length, START_OPEN + PER_DECADE * d)));
const newCatsOf = (d) => d === 0 ? [] :
  INTRO_ORDER.slice(
    Math.min(INTRO_ORDER.length, START_OPEN + PER_DECADE * (d - 1)),
    Math.min(INTRO_ORDER.length, START_OPEN + PER_DECADE * d));

// ── level tarifi ──
// Funnel numaralandırması: 1-4 öğretici (elle sticker, burada ATLANIR),
// 5-10 giriş (aşağıda introRecipe), 11+ ana döngü — decade/pozisyon
// matematiği 10 kaydırılarak işler (fNo = no - 10).
const CYCLE_START = 11;

// giriş levelleri (5-10): decade-0 disiplini ama en geniş ayrışma —
// ilk kategoriler, sıkı benzerlik eşiği, renk yelpazesi zorunlu, mono yok
function introRecipe(no, pairsN) {
  const open = openCats(0);
  const temaKats = new Set();
  const openList = [...open];
  for (let s = 0; temaKats.size < 3 && s < openList.length; s++) {
    temaKats.add(openList[(no + s * 2) % openList.length]);
  }
  return { d: 0, pos: no, open, simThr: 0.23,
           maxPerColor: Math.ceil(pairsN / 5), temaKats,
           monoColors: null, featCat: null,
           uniqCatColor: true }; // girişte aynı kategori+renk iki kez asla
}

// fNo (1..N, döngü-içi numara) → { simThr, maxPerColor, temaKats, ... }
// monoMode: "pos" (1010 funnel: pos 6 / pos 10) | "label" (etiketli funnel:
// slot seçimi dışarıda, forceMono ile gelir)
function recipeOf(fNo, pairsN, forceMono) {
  const no = fNo; // döngü içi numara (tanıtım/favori fazları buna bağlı)
  const d = Math.floor((no - 1) / 10);
  const pos = ((no - 1) % 10) + 1;
  const c = concave(d);
  const open = openCats(d);
  const news = newCatsOf(d);
  // ayrışma rampası: benzerlik eşiği sıkı→gevşek, renk kotası geniş→serbest
  const simThr = c < 0.33 ? 0.23 : c < 0.66 ? 0.21 : 0.19;
  const maxPerColor = c < 0.33 ? Math.ceil(pairsN / 5)
    : c < 0.66 ? Math.ceil(pairsN / 3) : pairsN;

  // mono/duo slotları — yalnız küçük board (≤24 çift = dolu 6x8).
  // Yeni funnel'da pos 6 ve pos 10 zaten 6x8'dir; daha büyük bir board
  // aynı indekse düşerse (eski funnel içe aktarımı) tek renk havuzu
  // benzerlik eşiğiyle dolmaz, normal karışım kullanılır.
  const monoSlot = MONO_MODE === "label" ? !!forceMono
    : (pos === 6 || (pos === 10 && d % 4 === 3)) && pairsN <= 24;
  if (monoSlot) {
    const kind = (MONO_MODE === "label" || pos === 6) && d % 3 === 2 ? "duo" : "mono";
    const colors = kind === "mono"
      ? [MONO_COLORS[d % MONO_COLORS.length]]
      : DUO_COLORS[Math.floor(d / 3) % DUO_COLORS.length];
    // mono/duo'da renk kotası yok. Benzerlik eşiği kademeli: aynı-renk
    // stickerlar RMS metriğinde doğal olarak yakındır (renk payı baskın),
    // 0.23 ulaşılamaz — seçici 0.22'den başlayıp gevşer, ulaşılabilir en
    // ayrık silüet setini toplar ("10'dayken kesin kolay"ın algı ayağı;
    // taban 0.19 yine mutlak yasak).
    return { d, pos, open, simThr: 0.22, maxPerColor: pairsN,
             temaKats: null, monoColors: colors, featCat: null };
  }

  // tanıtım: yeni kategoriler pos 1/2'de ağırlıklı sunulur
  let featCat = null;
  if (news.length && pos <= news.length) featCat = news[pos - 1];

  // tema: 2-4 kategori, decade+pozisyonla döner; her 5 levelda bir favori
  // kategori araya girer ("bazen artmalı")
  const openList = [...open];
  const k = 2 + ((d + pos) % 3);
  const temaKats = new Set();
  if (featCat) temaKats.add(featCat);
  if (no % 5 === 0) temaKats.add(FAVS[Math.floor(no / 5) % FAVS.length]);
  let step = 0;
  while (temaKats.size < k && step < openList.length) {
    const cat = openList[(no * 7 + step * 3) % openList.length];
    step++;
    // uyumluluk: tema setine yasaklı çift sokma
    const f = forbiddenWith.get(cat);
    if (f && [...temaKats].some((t) => f.has(t))) continue;
    temaKats.add(cat);
  }
  return { d, pos, open, simThr, maxPerColor, temaKats, monoColors: null, featCat };
}

// ── seçici ──
// Havuzdan n sid seç: benzerlik eşiği + renk kotası + kategori uyumluluğu +
// kategori kotası. Tıkanırsa kademeli gevşetir (tema → açık kategoriler →
// eşik 0.19 → renk kotası serbest → katalog geneli). Son kaynak asla
// gerekmemeli; gerekirse uyarı basar.
function pickStickers(no, pairsN, rec, recentUse) {
  const rng = mulberry32((no * 2654435761) >>> 0);
  const inColors = rec.monoColors ? new Set(rec.monoColors) : null;

  const candidatesFrom = (cats, colorSet) => catalog.filter((r) =>
    (!cats || cats.has(r.cat)) && (!colorSet || colorSet.has(r.color)));

  // gevşeme kademeleri
  const stages = [];
  if (rec.temaKats) stages.push({ cats: rec.temaKats, colors: inColors, thr: rec.simThr, quota: true });
  stages.push({ cats: rec.open, colors: inColors, thr: rec.simThr, quota: true });
  if (rec.monoColors) {
    // mono/duo: eşik kademeli gevşer — ulaşılabilir en ayrık set
    for (const thr of [0.21, 0.20]) {
      stages.push({ cats: rec.open, colors: inColors, thr, quota: true });
    }
  }
  stages.push({ cats: rec.open, colors: inColors, thr: 0.19, quota: true });
  stages.push({ cats: rec.open, colors: inColors, thr: 0.19, quota: false });
  stages.push({ cats: null, colors: inColors, thr: 0.19, quota: false });

  const picked = [];
  const pickedSet = new Set();
  const colorCount = new Map();
  const catCount = new Map();
  const catsUsed = new Set();
  const catColorUsed = new Set();

  const conflicts = (sid, thr) => {
    const sims = simOf.get(sid);
    if (!sims) return false;
    for (const { sid: other, d } of sims) {
      if (d < thr && pickedSet.has(other)) return true;
    }
    return false;
  };

  for (const st of stages) {
    if (picked.length >= pairsN) break;
    // aday sırası: seed'li karışım; yakın geçmişte kullanılanlar sona
    // (leveller arası çeşitlilik), tanıtım kategorisi öne
    let pool = shuffle(candidatesFrom(st.cats, st.colors), rng);
    pool.sort((a, b) =>
      ((recentUse.get(a.sid) || 0) - (recentUse.get(b.sid) || 0)) ||
      ((a.cat === rec.featCat ? -1 : 0) - (b.cat === rec.featCat ? -1 : 0)));
    // duo: iki renk dengeli tüketilsin — hedef yarı yarıya
    const duoTarget = rec.monoColors && rec.monoColors.length === 2
      ? Math.ceil(pairsN / 2) : null;

    for (const r of pool) {
      if (picked.length >= pairsN) break;
      if (pickedSet.has(r.sid)) continue;
      const f = forbiddenWith.get(r.cat);
      if (f && [...catsUsed].some((c) => f.has(c))) continue;
      if (st.quota && !rec.monoColors &&
          (colorCount.get(r.color) || 0) >= rec.maxPerColor) continue;
      if (st.quota && rec.uniqCatColor && catColorUsed.has(r.cat + "|" + r.color)) continue;
      if (duoTarget && (colorCount.get(r.color) || 0) >= duoTarget) continue;
      // kategori kotası: tanıtım/mono dışında tek kategori yarıyı aşmasın
      if (st.quota && !rec.monoColors && r.cat !== rec.featCat &&
          (catCount.get(r.cat) || 0) >= Math.ceil(pairsN / 2)) continue;
      if (conflicts(r.sid, st.thr)) continue;
      picked.push(r.sid);
      pickedSet.add(r.sid);
      catsUsed.add(r.cat);
      catColorUsed.add(r.cat + "|" + r.color);
      colorCount.set(r.color, (colorCount.get(r.color) || 0) + 1);
      catCount.set(r.cat, (catCount.get(r.cat) || 0) + 1);
    }
  }
  if (picked.length < pairsN) {
    throw new Error("sticker seçilemedi: level " + no + " (" + picked.length +
      "/" + pairsN + ")");
  }
  // tanıtım kategorisi öndeyse karıştır — boardda kümelenme cells sırasına
  // değil çift kimliğine bağlı zaten; yine de sid listesi karışık dursun
  return shuffle(picked, rng);
}

// ── koşum ──
const files = fs.readdirSync(OUT)
  .filter((f) => FILE_RE.test(f))
  .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
if (!files.length) throw new Error(path.basename(OUT) + " boş — önce tools/export_levels.js (veya gen_v2_levels.js)");

// mono slot modu: etiketli funnel (vh harfi var) → her decade'in (11+)
// generator'sız ilk e levelı (≤32 çift); yoksa eski pozisyon kuralı.
const MONO_MODE = files.some((f) => /_vh\.json$/.test(f)) ? "label" : "pos";
const monoSet = new Set();
if (MONO_MODE === "label") {
  const seen = new Set();
  for (const f of files) {
    const no = parseInt(f, 10);
    if (no < CYCLE_START) continue;
    const d = Math.floor((no - 1) / 10);
    if (seen.has(d) || !/_e\.json$/.test(f)) continue;
    const j = JSON.parse(fs.readFileSync(path.join(OUT, f), "utf8"));
    const pairsN = Math.max(0, ...j.cells);
    if (j.TileGenerators && j.TileGenerators.length) continue;
    if (pairsN > 32) continue;
    seen.add(d); monoSet.add(no);
  }
}

const recentUse = new Map(); // sid → son kullanım level no (yakınlık cezası)
const stats = { mono: [], duo: [], intro: [], skipped: 0 };
for (const f of files) {
  const no = parseInt(f, 10);
  const j = JSON.parse(fs.readFileSync(path.join(OUT, f), "utf8"));
  // çift sayısı: cells + generator kuyrukları (v3: kuyruktaki taş boardda değil)
  const pairsN = Math.max(0, ...j.cells, ...(j.TileGenerators || []).flatMap((g) => g.Tiles));
  // 1-4: öğretici — elle seçilmiş stickers korunur (kaynak tutorial_levels/)
  if (no <= 4) {
    if (!Array.isArray(j.stickers)) throw new Error(f + ": öğreticide stickers yok");
    j.stickers.forEach((s) => recentUse.set(s, no));
    stats.skipped++;
    continue;
  }
  // 5-10 giriş tarifi küçük board içindir (yeni funnel rampası). Daha büyük
  // bir board aynı numaraya düşerse uniqCatColor kotası 0.23 eşiğini
  // tutturamaz; normal decade-0 karışımı kullanılır.
  const rec = no < CYCLE_START && pairsN <= 24
    ? introRecipe(no, pairsN)
    : recipeOf(Math.max(1, no - CYCLE_START + 1), pairsN, monoSet.has(no));
  const sids = pickStickers(no, pairsN, rec, recentUse);
  sids.forEach((s) => recentUse.set(s, no));
  // yakınlık cezası pencere dışına çıkanları temizle (son 3 level)
  for (const [s, n] of recentUse) if (no - n > 3) recentUse.delete(s);

  if (rec.monoColors) {
    (rec.monoColors.length === 1 ? stats.mono : stats.duo)
      .push(no + ":" + rec.monoColors.join("+"));
  }
  if (rec.featCat) stats.intro.push(no + ":" + rec.featCat);

  // dosyayı aynı hücre düzeniyle, stickers ekleyerek yeniden yaz
  const w = String(pairsN).length + 1;
  const rowsTxt = [];
  for (let rr = 0; rr < j.height; rr++) {
    const row = j.cells.slice(rr * j.width, (rr + 1) * j.width);
    rowsTxt.push("    " + row.map((v) => String(v).padStart(w)).join(","));
  }
  const json =
    "{\n" +
    '  "width": ' + j.width + ",\n" +
    '  "height": ' + j.height + ",\n" +
    '  "cells": [\n' + rowsTxt.join(",\n") + "\n  ],\n" +
    '  "stickers": [\n' +
    sids.map((s) => "    " + JSON.stringify(s)).join(",\n") +
    "\n  ]" +
    (j.TileGenerators
      ? ',\n  "TileGenerators": [\n' + j.TileGenerators.map((g) => "    " + JSON.stringify(g)).join(",\n") + "\n  ]"
      : "") +
    "\n}\n";
  fs.writeFileSync(path.join(OUT, f), json);
}

console.log("stickers yazıldı: " + (files.length - stats.skipped) + " level (+ " +
  stats.skipped + " öğretici elle atanmış, korundu)");
console.log("mono (" + stats.mono.length + "): " + stats.mono.slice(0, 8).join(" ") + " …");
console.log("duo  (" + stats.duo.length + "): " + stats.duo.slice(0, 8).join(" ") + " …");
console.log("tanıtım (" + stats.intro.length + "): " + stats.intro.slice(0, 8).join(" ") + " …");
