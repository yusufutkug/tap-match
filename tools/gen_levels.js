"use strict";

// Boyut başına 100 levellik funnel paketleri yazar:
//   node tools/gen_levels.js → ../levels_gen.js (TM_PACKS)
// Deterministik: aynı tablolar + seed her zaman aynı paketleri üretir.
//
// Oyuncu önce boyutu, sonra leveli seçer; her boyutun kendi 100 levellik
// AG tarzı testere-dişi funnel'ı vardır (10 levellik döngü × 10 dekat):
//   slot:   1     2     3      4      5     6     7     8      9         10
//   etiket: easy  easy  medium medium hard  easy  easy  medium veryhard  easy
// Aynı etiket dekat ilerledikçe rampa katsayısıyla (t = (dekat-1)/9)
// sertleşir — zorluk hem etiketle hem indexle korele.
//
// Doluluk sözleşmesi: her level ≥ %50 dolu (fillMin), etiket hedefi
// %52-60 — çift sayısı hedeften türetilir (lockedN alana ve derinliğe göre
// çözülür). Köşe oranı önceki pakete göre bilinçli düşük tutulur
// (cornerP 0.30-0.65 bandı): girişler/dipler zaten hizalı taban koyar.

const fs = require("fs");
const path = require("path");
const { generateLevel } = require("../js/generator.js");

const ALL_SIZES = ["6x8", "6x9", "7x9", "7x10", "8x10", "8x12", "8x14", "9x12", "9x15", "12x18"];
// hızlı deneme: TM_SIZES=6x8,12x18 node tools/gen_levels.js (dosya yazmaz)
const SIZES = process.env.TM_SIZES ? process.env.TM_SIZES.split(",") : ALL_SIZES;
const DRY = !!process.env.TM_SIZES;

const LABELS = ["easy", "easy", "medium", "medium", "hard",
                "easy", "easy", "medium", "veryhard", "easy"];
const NAMES = { easy: "Kolay", medium: "Orta", hard: "Zor", veryhard: "Çok Zor" };
const TARGET_FILL = { easy: 0.52, medium: 0.55, hard: 0.57, veryhard: 0.60 };

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// Etiket bandı + dekat rampası → generateLevel parametreleri.
// Çift sayısı doluluk hedefinden çözülür: pairs ≈ entry + kapı×L + kilitli×L.
function paramsOf(label, idx, rows, cols) {
  const decade = Math.ceil(idx / 10);
  const t = (decade - 1) / 9;
  const area = rows * cols;
  const giant = area >= 200; // 12×18: çift kapı

  let depthMin, depthMax, cornerP, extra = {};
  if (label === "easy") {
    depthMin = 3; depthMax = 3 + (decade >= 4 ? 1 : 0);
    cornerP = 0.30 + 0.15 * t;
    extra = { dipMax: 0.65 };
  } else if (label === "medium") {
    depthMin = 4; depthMax = 5 + (decade >= 6 ? 1 : 0);
    cornerP = 0.40 + 0.15 * t;
    extra = { dipMax: 0.5 };
  } else if (label === "hard") {
    depthMin = 5; depthMax = 7;
    cornerP = 0.50 + 0.10 * t;
    extra = { dipMax: 0.5, waistPosTarget: 0.40, waistOpenMax: decade >= 5 ? 3 : 4 };
  } else { // veryhard
    depthMin = decade === 1 ? 6 : 7; depthMax = 9;
    cornerP = 0.60 + 0.10 * t;
    extra = {
      dipMax: 0.45,
      waistPosTarget: 0.42 + 0.03 * t,
      waistOpenMax: decade >= 6 && !giant ? 2 : 3,
    };
  }
  // küçük boardlara dev zincir sığmaz: derinliği alana göre kırp.
  // hard tavanın 1 altında tutulur ki very hard her boyutta daha derin
  // zincir bandına sahip olsun (etiket ayrımı küçük boardlarda da korunur).
  const depthCap = Math.max(5, Math.round(Math.sqrt(area) * 1.05));
  depthMax = Math.min(depthMax, label === "hard" ? depthCap - 1 : depthCap);
  depthMin = Math.min(depthMin, depthMax);

  // very hard daha az girişle başlar (daha dar açılış = daha zor)
  const entryDiv = label === "easy" ? 16 : label === "veryhard" ? 24 : 20;
  const entryN = clamp(Math.round(area / entryDiv), 2, 8);
  const gateN = giant ? 2 : 1;
  const avgLen = (depthMin + depthMax) / 2;
  const pairsTarget = Math.round(area * TARGET_FILL[label] / 2);
  const lockedN = Math.max(label === "easy" ? 0 : 1,
    Math.round((pairsTarget - entryN - gateN * avgLen) / avgLen));

  return { entryN, lockedN, gateN, depthMin, depthMax, cornerP, fillMin: 0.50, ...extra };
}

// Üretim garantisi: sıkışan reçete kademeli gevşetilir — funnel'da delik kalamaz.
function generateWithRelax(recipe) {
  const steps = [
    (o) => o,
    (o) => ({ ...o, maxAttempts: 3000 }),
    (o) => ({ ...o, maxAttempts: 3000, waistOpenMax: o.waistOpenMax ? o.waistOpenMax + 1 : undefined }),
    (o) => ({ ...o, maxAttempts: 3000, waistOpenMax: undefined, lockedN: o.lockedN + 1 }), // doluluk için zincir ekle
    (o) => ({ ...o, maxAttempts: 3000, waistOpenMax: undefined, fillMin: 0.47, depthMin: Math.max(3, o.depthMin - 1) }),
    (o) => ({ ...o, maxAttempts: 4000, waistOpenMax: undefined, waistPosTarget: undefined, fillMin: 0.44, lockedN: Math.max(0, o.lockedN - 1), depthMin: Math.max(3, o.depthMin - 1) }),
  ];
  for (let i = 0; i < steps.length; i++) {
    const lv = generateLevel(steps[i](recipe));
    if (lv) return { lv, relaxed: i };
  }
  return null;
}

// Karşılaştırılabilir zorluk skoru (dekat içi sıralama + trend kontrolü).
// Doluluk sabitlendiği için çift sayısı etiketler arasında ayırt edici
// değil — skor yapısal metriklerden gelir: derinlik (zincir uzunluğu),
// efor zirvesi (arama alanı), köşe payı (bilişsel yük); belde nefes
// alanı arttıkça kolaylaşır.
function scoreOf(lv) {
  return lv.flow.depth * 1.0 +
    lv.curve.effortPeak * 0.05 +
    lv.curve.cornerShare * 4 +
    lv.pairs.length * 0.05 -
    lv.waistOpenAbs * 0.7;
}

function buildLevel(sizeIdx, rows, cols, idx, seedOffset) {
  const label = LABELS[(idx - 1) % 10];
  const recipe = {
    rows, cols,
    ...paramsOf(label, idx, rows, cols),
    seed: 30000 + sizeIdx * 100000 + idx + (seedOffset || 0) * 1000,
    maxAttempts: 1500,
  };
  const res = generateWithRelax(recipe);
  if (!res) return null;
  const { lv, relaxed } = res;
  return {
    id: idx, name: NAMES[label], rows, cols,
    pairs: lv.pairs, seed: lv.seed,
    meta: {
      label,
      score: +scoreOf(lv).toFixed(2),
      depth: lv.flow.depth,
      dip: +lv.curve.dip.toFixed(3),
      fill: +lv.fill.toFixed(3),
      cornerShare: +lv.curve.cornerShare.toFixed(3),
      waistPos: +lv.curve.waistPos.toFixed(3),
      waistOpenAbs: lv.waistOpenAbs,
      fused: lv.fused,
      inertEntries: lv.inertEntries,
      effortPeak: +lv.curve.effortPeak.toFixed(1),
      relaxed,
    },
  };
}

const ORDER = ["easy", "medium", "hard", "veryhard"];
const packs = [];

for (let si = 0; si < SIZES.length; si++) {
  const size = SIZES[si];
  const [cols, rows] = size.split("x").map(Number);
  const t0 = Date.now();
  const levels = [];
  for (let idx = 1; idx <= 100; idx++) {
    const level = buildLevel(si, rows, cols, idx, 0);
    if (!level) {
      console.error("ÜRETİLEMEDİ: " + size + " level " + idx);
      process.exit(1);
    }
    levels.push(level);
  }

  // Onarım geçidi: dekat içi easy<medium<hard≤veryhard sıralamasını ve
  // hafif tolere edilmiş dekatlar arası yükselişi bozan levelleri farklı
  // seedlerle yeniden üret (skor tabanını geçen ilk aday, yoksa en yükseği).
  // skoru (floor, ceil) bandına çek: banda giren ilk aday, yoksa en yakını.
  // kBase: geçiş başına farklı seed havuzu (aynı adayları tekrar denemez).
  function rerollBand(idx, floor, ceil, kBase) {
    const cur = levels[idx - 1];
    const dist = (s) => Math.max(floor - s, s - ceil, 0);
    let best = cur, bestD = dist(cur.meta.score);
    if (bestD === 0) return;
    for (let k = 1; k <= 15; k++) {
      const cand = buildLevel(si, rows, cols, idx, (kBase || 0) + k);
      if (!cand) continue;
      const d = dist(cand.meta.score);
      if (d < bestD) { best = cand; bestD = d; }
      if (d === 0) break;
    }
    if (best !== cur) levels[idx - 1] = best;
  }
  const rerollAbove = (idx, floor, kBase) => rerollBand(idx, floor, Infinity, kBase);
  const meanOf = (d, lab) => {
    const xs = levels.slice((d - 1) * 10, d * 10)
      .filter((l) => l.meta.label === lab).map((l) => l.meta.score);
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  };
  const orderedD = (d) =>
    meanOf(d, "easy") < meanOf(d, "medium") &&
    meanOf(d, "medium") < meanOf(d, "hard") &&
    meanOf(d, "hard") <= meanOf(d, "veryhard") + 1e-9;

  for (let pass = 0; pass < 5; pass++) {
    let prevHard = -Infinity, prevVh = -Infinity;
    for (let d = 1; d <= 10; d++) {
      const hardIdx = (d - 1) * 10 + 5, vhIdx = (d - 1) * 10 + 9;
      const kBase = pass * 20;
      if (pass === 0 || !orderedD(d)) {
        // medium: her biri easy ortalamasının üstüne çekilir (3 level/dekat)
        for (const slot of [3, 4, 8]) {
          rerollAbove((d - 1) * 10 + slot, meanOf(d, "easy") + 0.4, kBase);
        }
        rerollAbove(hardIdx, Math.max(meanOf(d, "medium") + 0.5, prevHard - 1), kBase);
        rerollAbove(vhIdx, Math.max(levels[hardIdx - 1].meta.score + 0.5, prevVh - 1), kBase);
        // yukarı çekilemeyen taraf varsa üsttekini banda indir (çift yönlü)
        if (levels[vhIdx - 1].meta.score <= levels[hardIdx - 1].meta.score) {
          rerollBand(hardIdx, meanOf(d, "medium") + 0.5,
            levels[vhIdx - 1].meta.score - 0.3, kBase);
        }
        if (levels[hardIdx - 1].meta.score <= meanOf(d, "medium")) {
          for (const slot of [3, 4, 8]) {
            rerollBand((d - 1) * 10 + slot, meanOf(d, "easy") + 0.4,
              levels[hardIdx - 1].meta.score - 0.3, kBase);
          }
        }
      }
      prevHard = Math.max(prevHard, levels[hardIdx - 1].meta.score);
      prevVh = Math.max(prevVh, levels[vhIdx - 1].meta.score);
    }
    let allOk = true;
    for (let d = 1; d <= 10; d++) if (!orderedD(d)) allOk = false;
    if (allOk) break;
  }

  // veryhard trend garantisi: son iki dekat, ilk iki dekattan yüksek olmalı
  // (index korelasyonunun test edilen omurgası). Sıralamayı bozmaz: taban
  // her zaman o dekattaki hard'ın üstünde kalır.
  {
    const firstVh = (meanOf(1, "veryhard") + meanOf(2, "veryhard")) / 2;
    for (const d of [9, 10]) {
      const hardScore = levels[(d - 1) * 10 + 5 - 1].meta.score;
      rerollAbove((d - 1) * 10 + 9, Math.max(firstVh + 0.5, hardScore + 0.5), 200);
    }
  }

  // Paket özeti
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const fills = levels.map((l) => l.meta.fill);
  const corners = levels.map((l) => l.meta.cornerShare);
  let orderFails = 0;
  const trendBits = [];
  for (let d = 1; d <= 10; d++) if (!orderedD(d)) orderFails++;
  for (const lab of ORDER) {
    const first = (meanOf(1, lab) + meanOf(2, lab)) / 2;
    const last = (meanOf(9, lab) + meanOf(10, lab)) / 2;
    trendBits.push(lab[0] + (last > first ? "✓" : "✗"));
  }
  const relaxedN = levels.filter((l) => l.meta.relaxed > 0).length;
  if (process.env.TM_DEBUG) {
    console.log("  dekat  easy   med    hard   vhard");
    for (let d = 1; d <= 10; d++) {
      console.log("  " + String(d).padEnd(7) +
        ORDER.map((lab) => meanOf(d, lab).toFixed(1).padEnd(7)).join(""));
    }
    console.log("  örnek leveller (dekat 5): " +
      levels.slice(40, 50).map((l) => l.meta.label[0] + ":" + l.meta.score.toFixed(1) +
        "(d" + l.meta.depth + ",e" + l.meta.effortPeak.toFixed(0) + ",k" +
        Math.round(l.meta.cornerShare * 100) + ",w" + l.meta.waistOpenAbs + ")").join(" "));
  }
  console.log(
    size.padEnd(7) +
    "fill: " + Math.min(...fills).toFixed(2) + "-" + Math.max(...fills).toFixed(2) +
    " (ort " + avg(fills).toFixed(2) + ")" +
    "  bel-köşe%: " + Math.round(avg(corners) * 100) +
    "  sıralama: " + (10 - orderFails) + "/10" +
    "  trend: " + trendBits.join("") +
    "  gevşetilen: " + relaxedN +
    "  süre: " + ((Date.now() - t0) / 1000).toFixed(0) + "sn"
  );
  if (orderFails) console.log("  UYARI: " + size + " içinde " + orderFails + " dekatta sıralama sapıyor");

  packs.push({ size, cols, rows, levels });
}

if (DRY) {
  console.log("\n(kuru koşu: TM_SIZES filtresi aktif, dosya yazılmadı)");
} else {
  const out =
    '"use strict";\n\n' +
    "// ÜRETİLMİŞ paketler — elle düzenleme; kaynak: tools/gen_levels.js\n" +
    "// Boyut başına 100 levellik funnel (E-E-M-M-H-E-E-M-VH-E × 10 dekat).\n\n" +
    "var TM_PACKS = " + JSON.stringify(packs) + ";\n\n" +
    'if (typeof module !== "undefined") module.exports = { TM_PACKS };\n';

  fs.writeFileSync(path.join(__dirname, "..", "levels_gen.js"), out);
  const kb = Math.round(out.length / 1024);
  console.log("\nlevels_gen.js yazıldı (" + packs.length + " paket × 100 level, " + kb + " KB)");
}
