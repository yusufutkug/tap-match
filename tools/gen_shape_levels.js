"use strict";

// Tam dolu şekil paketleri yazar:
//   node tools/gen_shape_levels.js → ../levels_shapes.js (TM_SHAPE_PACKS)
// Deterministik: aynı tablolar + seed her zaman aynı paketleri üretir.
//
// Her boyut için 50 level. Şekil havuzu: 4 tek parça (kalp, çarpı, çerçeve,
// halka) + 4 ada maskesi (papyon, yonca, takımada, bantlar) + dolu; tek
// parça şekiller yer yer KESME HATTIyla gelir (açılış hamleleri şekli
// gözle görülür adalara böler). Akış reçetesi 10'luk bantlarla sertleşir
// (soyma kadranları + tempo senaryosu — bkz. js/generator.js peelBuild):
//   L1-10 : saf akış — yılan, giriş 1, düğüm 0 (yerel devam hep elde)
//   L11-20: parçalanma tanışması — bölge, kesme hattı ilk kez, düğüm 1
//   L21-30: adalar — ada maskeleri ağırlıklı, bölge, düğüm 2, bel 3
//   L31-40: git-gel — ada+kesme karışık, cepheler 0.8, düğüm 3, uzun ışın
//   L41-50: en zor — giriş 4, dar bel (2), düğüm 4, köşe/uzak ağır
// Etiket şeridi (meta.label) banda göre: easy easy medium hard veryhard.
//
// Hızlı deneme: TM_SIZES=6x8 node tools/gen_shape_levels.js (dosya yazmaz)

const fs = require("fs");
const path = require("path");
const { TM_SHAPES } = require("../js/shapes.js");
const { generateFullLevel } = require("../js/generator.js");
const { pairsCurve, analyzeFlow, localityStats } = require("../js/flow.js");

const ALL_SIZES = ["6x8", "6x9", "7x9", "7x10", "8x10", "8x12", "8x14", "9x12", "9x15", "12x18"];
const SIZES = process.env.TM_SIZES ? process.env.TM_SIZES.split(",") : ALL_SIZES;
const DRY = !!process.env.TM_SIZES;

// 10'luk bantlar: row = bant içi şekil rotasyonu (dizge ya da {s, cut}),
// geri kalanı soyma kadranları. knots null değil = tempo senaryosu açık.
const BANDS = [
  { label: "easy", knots: 0,
    frontMode: "yilan", entryN: 1, frontBias: 1.0, cornerP: 0.35, spanBias: 0.30,
    row: ["kalp", "papyon", "cerceve", "bantlar", "halka",
          "papyon", "kalp", "bantlar", "cerceve", "halka"] },
  { label: "easy", knots: 1,
    frontMode: "bolge", entryN: 2, frontBias: 1.0, cornerP: 0.45, spanBias: 0.40,
    row: [{ s: "dolu", cut: "dikey" }, "papyon", { s: "kalp", cut: "dikey" }, "bantlar",
          { s: "cerceve", cut: "dikey" }, "yonca", { s: "halka", cut: "dikey" },
          "takimada", { s: "carpi", cut: "dikey" }, "papyon"] },
  { label: "medium", knots: 2, waistOpen: 3,
    frontMode: "bolge", entryN: 2, frontBias: 1.0, cornerP: 0.55, spanBias: 0.50,
    row: ["papyon", "yonca", "takimada", "bantlar", { s: "kalp", cut: "yatay" },
          "yonca", { s: "cerceve", cut: "yatay" }, "takimada",
          { s: "dolu", cut: "yatay" }, "bantlar"] },
  { label: "hard", knots: 3, waistOpen: 3,
    frontMode: "cepheler", entryN: 3, frontBias: 0.8, cornerP: 0.65, spanBias: 0.60,
    row: ["yonca", { s: "carpi", cut: "dikey" }, "takimada", { s: "halka", cut: "yatay" },
          "papyon", { s: "kalp", cut: "dikey" }, "bantlar",
          { s: "cerceve", cut: "dikey" }, "yonca", { s: "dolu", cut: "dikey" }] },
  { label: "veryhard", knots: 4, waistOpen: 2,
    frontMode: null, entryN: 4, cornerP: 0.75, spanBias: 0.75,
    row: [{ s: "kalp", cut: "dikey" }, "yonca", "takimada", { s: "cerceve", cut: "yatay" },
          "papyon", { s: "carpi", cut: "dikey" }, "bantlar",
          { s: "halka", cut: "dikey" }, "yonca", { s: "dolu", cut: "yatay" }] },
];

function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function buildPack(sizeStr) {
  const [cols, rows] = sizeStr.split("x").map(Number);
  const levels = [];
  for (let id = 1; id <= 50; id++) {
    const band = BANDS[Math.floor((id - 1) / 10)];
    const spec = band.row[(id - 1) % 10];
    const shape = typeof spec === "string" ? spec : spec.s;
    const wantCut = typeof spec === "string" ? null : spec.cut;
    const mask = TM_SHAPES.maskFor(shape, rows, cols);
    if (!mask && shape !== "dolu") throw new Error("maske yok: " + shape + " " + sizeStr);

    let lv = null, usedCut = null;
    for (let retry = 0; retry < 30 && !lv; retry++) {
      // kesme bu boyutta/şekilde tutmuyorsa 15 denemeden sonra kesmesiz düş
      usedCut = retry < 15 ? wantCut : null;
      lv = generateFullLevel({
        rows, cols, mask,
        seed: hashSeed("tam:" + sizeStr + ":" + id + ":" + retry),
        entryN: band.entryN,
        frontMode: band.frontMode,
        frontBias: band.frontBias,
        cornerP: band.cornerP,
        spanBias: band.spanBias,
        waistOpen: band.waistOpen,
        knots: band.knots,
        cut: usedCut,
      });
    }
    if (!lv) throw new Error("üretilemedi: " + sizeStr + " #" + id);

    // sözleşme: %100 dolu + çözülebilir + deadlock yok
    if (lv.pairs.length * 2 !== lv.maskArea) throw new Error("doluluk bozuk: " + sizeStr + " #" + id);
    if (!pairsCurve(lv.pairs, rows, cols)) throw new Error("çözülemez: " + sizeStr + " #" + id);
    if (analyzeFlow(lv.pairs, rows, cols).deadlocked.length) throw new Error("deadlock: " + sizeStr + " #" + id);
    const loc = localityStats(lv.pairs, rows, cols);
    if (!loc) throw new Error("yerellik ölçülemedi: " + sizeStr + " #" + id);

    levels.push({
      id,
      name: TM_SHAPES.DEFS[shape].name,
      rows, cols,
      pairs: lv.pairs,
      seed: lv.seed,
      mask: TM_SHAPES.encode(lv.mask),
      meta: {
        label: band.label,
        shape,
        cut: usedCut,
        mode: band.frontMode || "serbest",
        entryN: band.entryN,
        knotsTarget: band.knots,
        maskArea: lv.maskArea,
        entries: lv.entries,
        depth: lv.flow.depth,
        cornerShare: +lv.curve.cornerShare.toFixed(3),
        waistOpenAbs: lv.waistOpenAbs,
        // yerellik (yerel-oyuncu simülasyonu — js/flow.js localityStats)
        knots: loc.knots,
        meanJump: +loc.meanJump.toFixed(2),
        grind: loc.grindMax,
        splitT: loc.splitT === null ? null : +loc.splitT.toFixed(2),
      },
    });
  }
  return { size: "tam-" + sizeStr, cols, rows, full: true, levels };
}

const packs = [];
for (const s of SIZES) {
  const t0 = Date.now();
  const pk = buildPack(s);
  const avg = (f) => pk.levels.reduce((a, l) => a + f(l), 0) / pk.levels.length;
  const cuts = pk.levels.filter((l) => l.meta.cut).length;
  console.log(
    s.padEnd(7) +
    "çift " + avg((l) => l.pairs.length).toFixed(1).padEnd(7) +
    "düğüm " + avg((l) => l.meta.knots).toFixed(1).padEnd(6) +
    "sıçrama " + avg((l) => l.meta.meanJump).toFixed(2).padEnd(6) +
    "öğütme " + avg((l) => l.meta.grind).toFixed(1).padEnd(5) +
    "kesme " + cuts + "/50  " +
    ((Date.now() - t0) / 1000).toFixed(1) + " sn");
  packs.push(pk);
}

if (DRY) {
  console.log("(kuru koşu — dosya yazılmadı)");
} else {
  const out =
    '"use strict";\n\n' +
    "// Üretilmiş tam dolu şekil paketleri — ELLE DÜZENLEME.\n" +
    "// tools/gen_shape_levels.js yazar; reçeteler orada.\n\n" +
    "var TM_SHAPE_PACKS = " + JSON.stringify(packs) + ";\n\n" +
    'if (typeof module !== "undefined") module.exports = { TM_SHAPE_PACKS };\n';
  fs.writeFileSync(path.join(__dirname, "..", "levels_shapes.js"), out);
  console.log("yazıldı: levels_shapes.js (" + packs.length + " paket, " +
    packs.reduce((a, p) => a + p.levels.length, 0) + " level)");
}
