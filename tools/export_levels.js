"use strict";

// Efor paketlerini dış motor formatına TEK FUNNEL YOLU olarak aktarır:
//   node tools/export_levels.js → export_levels/<n>_<e|m|h>.json + funnel.csv
//   --offset K → mevcut paketler K+1'den numaralanır.
// Yalnız YAZILAN ARALIK (K+1 .. K+paketToplamı) tazelenir; aralık dışı
// dosyalar ARŞİVDİR (dondurulmuş eski nesiller) ve dokunulmaz. funnel.csv
// klasördeki TÜM levellerden (arşiv + yeni) numara sırasıyla yeniden
// kurulur. Mevcut düzen: 1-500 çeşitlilik nesli (bu paketler, düz koşum),
// 501-700 arşiv (501-600 göz-terimi öncesi nesil, 601-700 göz-terimli
// 20'lik nesil — git geçmişinden dondurulmuş kopyalar).
//
// Funnel yolu (boyut DEĞİŞKEN — katı merdiven değil): her levelın gerçek
// zorluğu yerel botla ölçülür (sweep effortMean; boyutu ve reçeteyi tek
// sayıda birleştirir), leveller efor yüzdeliğine çevrilir ve testere-dişi
// bir hedef eğrisine göre dizilir:
//   taban    slot 1→100 doğrusal tırmanır
//   testere  onluk içi ofsetler — pos 5 ve 9'da tepe, pos 6'da soluklanma,
//            pos 10'da büyük nefes (AG funnel deseninin efor karşılığı)
// Slot hedefine EN YAKIN efor yüzdelikli level seçilir; boyut çeşitliliği
// efor örtüşmesinden kendiliğinden gelir (zor 6x8 ≈ kolay 8x12), ayrıca
// anti-seri kuralı: aynı boyut art arda 3 kez gelmez (yakın alternatif
// varsa 2'de de değişir). Tamamen deterministik.
//
// Dosya formatı (hücre dizisi, index 0 = SOL ALT, satır satır yukarı):
//   { "width": 6, "height": 8, "cells": [ ... ] }
//   -1  oyun dışı hücre (bizim boardlarda yok: dikdörtgen boardda her
//       hücre tap'lenebilir — maske dışı hücreler de dot'tur)
//    0  dot (boş, tap'lenebilir hücre)
//   1+  sticker id = çift kimliği (1 tabanlı; her id tam iki hücrede)
// Dosya adı: <funnelNo>_<diff harfi>; veryhard → "h" (dış şema e/m/h).
// İç temsil r=0 üst satır olduğundan dönüşüm: dışIdx = (rows-1-r)*cols + c.

const fs = require("fs");
const path = require("path");
const { readPack } = require("./pack_io.js");
const { effortCurve } = require("../js/flow.js");

const DIFF = { easy: "e", medium: "m", hard: "h", veryhard: "h" };
const OFFSET = (() => {
  const a = process.argv.indexOf("--offset");
  return a >= 0 ? parseInt(process.argv[a + 1], 10) : 0;
})();
const LEVELS_DIR = path.join(__dirname, "..", "levels");
const OUT = path.join(__dirname, "..", "export_levels");

// onluk içi testere ofsetleri (efor yüzdeliği cinsinden)
const SAW = [-0.10, -0.05, 0.00, 0.04, 0.08, -0.12, -0.04, 0.04, 0.12, -0.16];

// ── levelleri topla ve eforlarını ölç ──
const pool = [];
for (const d of fs.readdirSync(LEVELS_DIR).filter((x) => x.startsWith("efor-")).sort()) {
  const pk = readPack(d);
  for (const lv of pk.levels) {
    const ec = effortCurve(lv.pairs, pk.rows, pk.cols, null, "sweep");
    pool.push({
      size: d.replace("efor-", ""), rows: pk.rows, cols: pk.cols,
      diff: lv.diff, pairs: lv.pairs, effort: ec.effortMean,
    });
  }
}
// efor yüzdeliği (eşitlikte havuz sırası — deterministik)
const order = pool.map((_, i) => i).sort((a, b) => pool[a].effort - pool[b].effort || a - b);
order.forEach((idx, rank) => { pool[idx].pct = rank / (order.length - 1); });

// ── funnel yolu: slot hedefine en yakın yüzdelik + anti-seri ──
const used = new Set();
const seq = [];
for (let slot = 0; slot < pool.length; slot++) {
  const target = Math.max(0, Math.min(1,
    slot / (pool.length - 1) + SAW[slot % 10]));
  const cands = pool
    .map((lv, i) => ({ i, d: Math.abs(lv.pct - target) }))
    .filter((c) => !used.has(c.i))
    .sort((a, b) => a.d - b.d || a.i - b.i);
  const prev = seq.length ? pool[seq[seq.length - 1]].size : null;
  const prev2 = seq.length > 1 ? pool[seq[seq.length - 2]].size : null;
  let pick = cands[0];
  // seri 2 olduysa boyutu ZORLA değiştir (geniş tolerans); değilse yakın
  // alternatif varsa yine değiştir (dar tolerans)
  const tol = prev === prev2 && prev !== null ? 0.15 : 0.06;
  if (pool[pick.i].size === prev) {
    const alt = cands.find((c) => pool[c.i].size !== prev && c.d <= cands[0].d + tol);
    if (alt) pick = alt;
  }
  used.add(pick.i);
  seq.push(pick.i);
}

// ── yaz ──
fs.mkdirSync(OUT, { recursive: true });
// yalnız yazılacak aralık tazelenir; aralık dışı dosyalar arşiv
for (const f of fs.readdirSync(OUT)) {
  const n = parseInt(f, 10);
  if (/^\d+_[emh]\.json$/.test(f) && n > OFFSET && n <= OFFSET + pool.length) {
    fs.unlinkSync(path.join(OUT, f));
  }
}
const names = [];
seq.forEach((idx, slot) => {
  const lv = pool[idx];
  const cells = new Array(lv.rows * lv.cols).fill(0);
  lv.pairs.forEach((pair, pi) => {
    for (const [r, c] of pair) cells[(lv.rows - 1 - r) * lv.cols + c] = pi + 1;
  });
  // okunur yazım: satır başına bir dizi satırı (ilk satır = boardun ALTI)
  const w = String(lv.pairs.length).length + 1;
  const rowsTxt = [];
  for (let rr = 0; rr < lv.rows; rr++) {
    const row = cells.slice(rr * lv.cols, (rr + 1) * lv.cols);
    rowsTxt.push("    " + row.map((v) => String(v).padStart(w)).join(","));
  }
  const json =
    "{\n" +
    '  "width": ' + lv.cols + ",\n" +
    '  "height": ' + lv.rows + ",\n" +
    '  "cells": [\n' + rowsTxt.join(",\n") + "\n  ]\n}\n";
  const name = (OFFSET + slot + 1) + "_" + DIFF[lv.diff];
  fs.writeFileSync(path.join(OUT, name + ".json"), json);
  names.push(name);
});
// funnel.csv klasördeki TÜM levellerden (arşiv + yeni), numara sırasıyla
const all = fs.readdirSync(OUT)
  .filter((f) => /^\d+_[emh]\.json$/.test(f))
  .map((f) => f.replace(".json", ""))
  .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
fs.writeFileSync(path.join(OUT, "funnel.csv"), all.join(",") + "\n");

// özet: boyut yolu (cols benzersiz kimlik: 6,7,8,9,10) + efor akışı
console.log("boyut yolu: " + seq.map((i) => pool[i].cols).join("-"));
const efs = seq.map((i) => pool[i].effort);
const chunk = Math.max(1, Math.ceil(efs.length / 20)); // 20 noktalı özet
console.log("efor yolu (" + chunk + "'lik ort): " +
  Array.from({ length: Math.ceil(efs.length / chunk) }, (_, k) => {
    const part = efs.slice(k * chunk, (k + 1) * chunk);
    return (part.reduce((a, b) => a + b, 0) / part.length).toFixed(0);
  }).join(" "));
console.log("export_levels/ yazıldı: " + seq.length + " level (" +
  (OFFSET + 1) + ".." + (OFFSET + seq.length) + ") + funnel.csv (toplam " +
  all.length + ")");
