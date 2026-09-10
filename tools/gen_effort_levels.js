"use strict";

// Efor-hedefli tam dolu paketler yazar:
//   node tools/gen_effort_levels.js → levels/efor-<boyut>/ + ../levels_efor.js
// Deterministik: aynı tablolar + seed her zaman aynı paketleri üretir.
// Hızlı deneme: TM_SIZES=6x8 node tools/gen_effort_levels.js (dosya yazmaz)
//
// Fikir: iç katman (js/generator.js generateFullLevel) yapısal kaliteyi,
// dış katman (bu dosya) EFOR EĞRİSİNİN ŞEKLİNİ seçer. Level başına CAND
// aday üretilir (türetilmiş seedler), her adayı yerel (sweep) ve ışın (ray)
// botları oynar; eğrilerinin hedef şablona (js/flow.js CURVE_TEMPLATES)
// RMSE ortalaması aday skoru olur (öncü ikili — bot ailesi bulgusu:
// hafızalı/karışım yerelle aynı ayrışmayı veriyor, bağımsız ikili bu).
// Hafızalı + karışım tutarlılık bandıdır: şablondan BAND'den fazla kaçan
// aday elenir (şekle uymaları değil, kaçmamaları istenir). En düşük skorlu
// aday paket levelı olur; skor ACCEPT altına inerse erken kabul.
//
// Paket düzeni: boyut başına 20 level — 1-10 "bel" (ortada zirve, sonda
// rahatlama), 11-20 "dalga" (iki tepe). Reçeteler şablona yatkın seçilir
// (kabul oranını asıl bu belirler): bel → tek parça şekil + düğüm/bel
// kısıtı (kısıtlanma ortada yoğunlaşır); dalga → KESME HATLI şekil (board
// iki adaya bölünür, her ada kendi keşif fazını getirir → iki tepe).
// Etiket şeridi her onlukta reçete sertleşmesiyle: 3 easy, 3 medium,
// 2 hard, 2 veryhard.

const { TM_SHAPES } = require("../js/shapes.js");
const { writePacks } = require("./pack_io.js");
const { generateFullLevel } = require("../js/generator.js");
const { isAdjacentCollinear } = require("../js/board.js");
const { effortCurve, shapeScore, CURVE_TEMPLATES, templateAt } = require("../js/flow.js");

const ALL_SIZES = ["6x8", "6x9", "7x9", "7x10", "8x10", "8x12", "8x14", "9x12", "9x15", "12x18"];
const SIZES = process.env.TM_SIZES ? process.env.TM_SIZES.split(",") : ALL_SIZES;
const DRY = !!process.env.TM_SIZES;

const CAND = 60;     // level başına aday tavanı (best-of-N, Aşama A)
const ACCEPT = 0.10; // erken kabul eşiği (RMSE — şablon fiilen oturdu)
const BAND = 0.35;   // hafızalı/karışım tutarlılık bandı (üstü elenir)
// Aşama B (mutasyon) değerlendirme bütçesi: board büyüdükçe artar — sorun
// büyük boardlarda (rastgele adayın uzun eğrisi şablona kendiliğinden
// oturmuyor), bütçe de oraya akar. 6x8→384, 9x15→1080, 12x18→1728.
// (Kalibrasyon: 12x18'de 432 eval 0.366→0.279 getirdi ve tırmanış doymadı.)
const mutBudget = (rows, cols) => Math.min(2000, Math.max(150, 8 * rows * cols));

const LABELS = ["easy", "easy", "easy", "medium", "medium",
                "medium", "hard", "hard", "veryhard", "veryhard"];

// Onluk reçeteleri (i = 0..9, onluk içi sertleşme):
// bel — tek parça şekiller, kesme yok; düğüm + dar bel ortada sıkışma yapar.
const BEL_SHAPES = ["dolu", "kalp", "cerceve", "halka", "dolu",
                    "kalp", "cerceve", "halka", "dolu", "carpi"];
// dalga — kesme hatlı şekiller; yön dönüşümlü. Kesme tutmazsa aday üretici
// önce diğer yönü, sonra dolu+dikey'i dener (fallback zinciri).
const DALGA_SHAPES = ["dolu", "kalp", "cerceve", "dolu", "halka",
                      "kalp", "dolu", "cerceve", "halka", "dolu"];

function recipeOf(tplId, i) {
  if (tplId === "bel") {
    return {
      shape: BEL_SHAPES[i], cut: null,
      entryN: 2, frontMode: "bolge", frontBias: 1.0,
      cornerP: 0.45 + 0.025 * i, spanBias: 0.40 + 0.03 * i,
      knots: i < 4 ? 2 : 3, waistOpen: i < 6 ? 3 : 2,
    };
  }
  return {
    shape: DALGA_SHAPES[i], cut: i % 2 === 0 ? "dikey" : "yatay",
    entryN: 2, frontMode: "bolge", frontBias: 1.0,
    cornerP: 0.50 + 0.02 * i, spanBias: 0.45 + 0.03 * i,
    knots: 2 + Math.floor(i / 3), waistOpen: null,
  };
}

function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Tek aday: kesme tutmazsa fallback zinciri (diğer yön → dolu + dikey).
function genCandidate(rows, cols, rec, seed) {
  const tries = rec.cut
    ? [{ shape: rec.shape, cut: rec.cut },
       { shape: rec.shape, cut: rec.cut === "dikey" ? "yatay" : "dikey" },
       { shape: "dolu", cut: "dikey" }]
    : [{ shape: rec.shape, cut: null }];
  for (const t of tries) {
    const mask = TM_SHAPES.maskFor(t.shape, rows, cols);
    if (!mask && t.shape !== "dolu") continue;
    const lv = generateFullLevel({
      rows, cols, mask, seed,
      entryN: rec.entryN, frontMode: rec.frontMode, frontBias: rec.frontBias,
      cornerP: rec.cornerP, spanBias: rec.spanBias,
      knots: rec.knots, waistOpen: rec.waistOpen, cut: t.cut,
    });
    if (lv) return { lv, shape: t.shape, cut: t.cut };
  }
  return null;
}

// Aday skoru: öncü ikili RMSE ortalaması. Tutarlılık bandını aşan aday
// elenmez ama ağır ceza yer (key) — bant içi aday varken asla seçilmez,
// hiç yoksa (büyük boardlarda olabiliyor) en az kaçanı son çare olur.
// Botlardan biri çözemezse (tıkalı) → null.
function scoreLevel(pairs, rows, cols, tpl) {
  const ecS = effortCurve(pairs, rows, cols, null, "sweep");
  if (!ecS) return null;
  const ecR = effortCurve(pairs, rows, cols, null, "ray");
  if (!ecR) return null;
  const sweep = shapeScore(ecS.effort, tpl);
  const ray = shapeScore(ecR.effort, tpl);
  let band = 0;
  for (const m of ["memory", "mix"]) {
    const ec = effortCurve(pairs, rows, cols, null, m);
    if (!ec) return null;
    band = Math.max(band, shapeScore(ec.effort, tpl));
  }
  const score = (sweep + ray) / 2;
  return { score, sweep, ray, band, key: score + (band > BAND ? 100 + band : 0), ecS };
}

// ── Aşama B: mutasyonla iyileştirme (rehberli hill-climb) ──────────────
// Rastgele aday havuzu büyük boardlarda şablonu tutturamıyor (uzun eğri
// kendiliğinden şekle oturmuyor); en iyi adayı alıp şekle doğru İTERİZ.
// Mutasyon = "repairing": iki çiftin 4 hücresi farklı eşlenir — tam doluluk
// yapıdan korunur; yasak yerleşim (hizalı+bitişik) ucuz elenir; çözülebilirlik
// bot koşusunda (null) elenir. Rehber: sweep eğrisinin şablondan en çok
// saptığı adım çevresinde kırılan çiftler %50 olasılıkla ilk eş olur (sapmayı
// yapan bölgeye nişan). Kabul: öncü skor (sweep+ray) iyileşmeli VE bant
// mevcut durumdan kötüleşmemeli (bant kontrolü yalnız iyileşmelerde koşar —
// eval maliyeti 4 yerine 2 bot). Deterministik: seed'li mulberry32.

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

// sweep eğrisinde şablondan en çok sapan adım çevresinde (±2) kırılan
// çift id'leri — mutasyonun nişan listesi
function guidePairs(ecS, tpl) {
  const eff = ecS.effort, L = eff.length;
  const sm = eff.map((_, i) => {
    let s = 0, n = 0;
    for (let j = i - 1; j <= i + 1; j++) {
      if (j >= 0 && j < L) { s += eff[j]; n++; }
    }
    return s / n;
  });
  const mx = Math.max(...sm);
  let worst = 0, wd = -1;
  for (let i = 0; i < L; i++) {
    const d = Math.abs((mx > 0 ? sm[i] / mx : 0) - templateAt(tpl, L > 1 ? i / (L - 1) : 0));
    if (d > wd) { wd = d; worst = i; }
  }
  const ids = [];
  for (let i = Math.max(0, worst - 2); i <= Math.min(L - 1, worst + 2); i++) {
    ids.push(...ecS.moves[i].pairIds);
  }
  return ids;
}

// iki çiftin 4 hücresini yeniden eşle; yasak yerleşimde null
function mutateOnce(pairs, rng, guide) {
  const n = pairs.length;
  let i;
  if (guide.length && rng() < 0.5) i = guide[Math.floor(rng() * guide.length)];
  else i = Math.floor(rng() * n);
  let j = Math.floor(rng() * (n - 1));
  if (j >= i) j++;
  const [a1, a2] = pairs[i], [b1, b2] = pairs[j];
  const alt = rng() < 0.5 ? [[a1, b1], [a2, b2]] : [[a1, b2], [a2, b1]];
  if (isAdjacentCollinear(alt[0]) || isAdjacentCollinear(alt[1])) return null;
  const next = pairs.slice();
  next[i] = alt[0];
  next[j] = alt[1];
  return next;
}

// öncü skor (sweep+ray) — mutasyon değerlendirmesinin ucuz yarısı
function leaderOf(pairs, rows, cols, tpl) {
  const ecS = effortCurve(pairs, rows, cols, null, "sweep");
  if (!ecS) return null;
  const ecR = effortCurve(pairs, rows, cols, null, "ray");
  if (!ecR) return null;
  return { leader: (shapeScore(ecS.effort, tpl) + shapeScore(ecR.effort, tpl)) / 2, ecS };
}
// bant (hafızalı/karışım maks RMSE) — yalnız iyileşme adaylarında koşar
function bandOf(pairs, rows, cols, tpl) {
  let band = 0;
  for (const m of ["memory", "mix"]) {
    const ec = effortCurve(pairs, rows, cols, null, m);
    if (!ec) return null;
    band = Math.max(band, shapeScore(ec.effort, tpl));
  }
  return band;
}

function refine(start, rows, cols, tpl, rng) {
  let cur = start; // { pairs, leader, band, ecS }
  let accepted = 0;
  const budget = mutBudget(rows, cols);
  for (let evals = 0; evals < budget && cur.leader > ACCEPT; evals++) {
    const next = mutateOnce(cur.pairs, rng, guidePairs(cur.ecS, tpl));
    if (!next) continue; // yasak yerleşim — bütçe yine işler (deterministik)
    const ls = leaderOf(next, rows, cols, tpl);
    if (!ls || ls.leader >= cur.leader - 1e-9) continue;
    const nb = bandOf(next, rows, cols, tpl);
    if (nb === null || nb > Math.max(BAND, cur.band)) continue;
    cur = { pairs: next, leader: ls.leader, band: nb, ecS: ls.ecS };
    accepted++;
  }
  return { ...cur, accepted };
}

function buildPack(sizeStr) {
  const [cols, rows] = sizeStr.split("x").map(Number);
  const levels = [];
  const stats = { bel: [], dalga: [], before: [], bandOut: 0 };
  for (let id = 1; id <= 20; id++) {
    const tplId = id <= 10 ? "bel" : "dalga";
    const tpl = CURVE_TEMPLATES[tplId];
    const i = (id - 1) % 10;
    const rec = recipeOf(tplId, i);
    let best = null;
    for (let cand = 0; cand < CAND; cand++) {
      const g = genCandidate(rows, cols, rec, hashSeed("efor:" + sizeStr + ":" + id + ":" + cand));
      if (!g) continue;
      const sc = scoreLevel(g.lv.pairs, rows, cols, tpl);
      if (!sc) continue;
      if (!best || sc.key < best.sc.key) best = { g, sc, cand };
      if (best.sc.key <= ACCEPT) break;
    }
    if (!best) throw new Error("aday bulunamadı: " + sizeStr + " #" + id);
    const { lv } = best.g;
    // sözleşme: %100 dolu (generateFullLevel garantisi; yine de doğrula)
    if (lv.pairs.length * 2 !== lv.maskArea) throw new Error("doluluk bozuk: " + sizeStr + " #" + id);

    // Aşama B: en iyi adayı mutasyonla şablona doğru it
    stats.before.push(best.sc.score);
    const ref = refine(
      { pairs: lv.pairs, leader: best.sc.score, band: best.sc.band, ecS: best.sc.ecS },
      rows, cols, tpl, mulberry32(hashSeed("efor-mut:" + sizeStr + ":" + id)));
    if (ref.band > BAND) stats.bandOut++;
    // mutasyon sözleşmesi: çift sayısı aynı, tüm hücreler benzersiz (tam dolu)
    const cellSet = new Set(ref.pairs.flat().map(([r, c]) => r * cols + c));
    if (ref.pairs.length !== lv.pairs.length || cellSet.size !== ref.pairs.length * 2) {
      throw new Error("mutasyon doluluğu bozdu: " + sizeStr + " #" + id);
    }
    // meta için bileşen RMSE'leri son halden ölç
    const ecS = effortCurve(ref.pairs, rows, cols, null, "sweep");
    const ecR = effortCurve(ref.pairs, rows, cols, null, "ray");
    stats[tplId].push(ref.leader);
    levels.push({
      id,
      name: TM_SHAPES.DEFS[best.g.shape].name + " · " + tplId,
      rows, cols,
      pairs: ref.pairs,
      seed: lv.seed,
      meta: {
        label: LABELS[i],
        template: tplId,
        shape: best.g.shape,
        cut: best.g.cut,
        score: +ref.leader.toFixed(3),
        sweepRmse: +shapeScore(ecS.effort, tpl).toFixed(3),
        rayRmse: +shapeScore(ecR.effort, tpl).toFixed(3),
        bandRmse: +ref.band.toFixed(3),
        cand: best.cand,
        mut: ref.accepted,
      },
    });
  }
  return { pack: { size: "efor-" + sizeStr, cols, rows, full: true, levels }, stats };
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const packs = [];
const allScores = [];
for (const s of SIZES) {
  const t0 = Date.now();
  const { pack, stats } = buildPack(s);
  packs.push(pack);
  allScores.push(...stats.bel, ...stats.dalga);
  const early = pack.levels.filter((l) => l.meta.score <= ACCEPT).length;
  const mutN = pack.levels.reduce((a, l) => a + l.meta.mut, 0);
  console.log(
    s.padEnd(7) +
    "bel " + mean(stats.bel).toFixed(3) + " (maks " + Math.max(...stats.bel).toFixed(3) + ")  " +
    "dalga " + mean(stats.dalga).toFixed(3) + " (maks " + Math.max(...stats.dalga).toFixed(3) + ")  " +
    "A→B " + mean(stats.before).toFixed(3) + "→" +
    mean(stats.bel.concat(stats.dalga)).toFixed(3) +
    " (" + mutN + " mut)  " +
    "erken kabul " + early + "/20  " +
    (stats.bandOut ? "bant dışı " + stats.bandOut + "  " : "") +
    ((Date.now() - t0) / 1000).toFixed(1) + " sn");
}

// eşik kalibrasyonu için skor dağılımı (seçilen levellar)
allScores.sort((a, b) => a - b);
const q = (p) => allScores[Math.min(allScores.length - 1, Math.floor(p * allScores.length))];
console.log("\nseçilen skor dağılımı: q10 " + q(0.1).toFixed(3) +
  " · medyan " + q(0.5).toFixed(3) + " · q90 " + q(0.9).toFixed(3) +
  " · maks " + allScores[allScores.length - 1].toFixed(3));

if (DRY) {
  console.log("(kuru koşu — dosya yazılmadı)");
} else {
  const r = writePacks({
    packs, base: "levels_efor", globalName: "TM_EFOR_PACKS",
    header:
      "// Üretilmiş efor-hedefli tam dolu paketler — ELLE DÜZENLEME; kanonik\n" +
      '// veri: levels/efor-<boyut>/ (şema: README "Level JSON formatı"),\n' +
      "// yazan: tools/gen_effort_levels.js; şablonlar js/flow.js\n" +
      "// CURVE_TEMPLATES (1-10 bel, 11-20 dalga).\n\n",
  });
  console.log("yazıldı: levels/efor-<boyut>/*.json + levels_efor.js (" +
    packs.length + " paket, " +
    packs.reduce((a, p) => a + p.levels.length, 0) + " level, sarmalayıcı " +
    r.jsKb + " KB)");
}
