"use strict";

// Efor-hedefli tam dolu paketler yazar:
//   node tools/gen_effort_levels.js → levels/efor-<boyut>/ + ../levels_efor.js
// Deterministik: aynı tablolar + seed her zaman aynı paketleri üretir.
// Hızlı deneme: TM_SIZES=6x8 node tools/gen_effort_levels.js (dosya yazmaz)
//
// Fikir: iç katman (js/generator.js generateFullLevel) yapısal kaliteyi,
// dış katman (bu dosya) EFOR EĞRİSİNİN ŞEKLİNİ ve YÜKSEKLİĞİNİ seçer.
// Level başına CAND aday üretilir (türetilmiş seedler), her adayı yerel
// (sweep) ve ışın (ray) botları oynar. Aday hedefi (leader) üç parça:
//   şekil   eğrilerin hedef şablona (js/flow.js CURVE_TEMPLATES) RMSE ort.
//   öğütme  "üst üste basit ama zorunlu uzun mesafe match" cezası — art
//           arda uzun HİZALI (koridor) çift kıran hamlelerin payı × GRIND_W
//           (oyuncu bulgusu: akma/düğüm hissine hizmet etmiyor, amelelik)
//   efor    aday kendi havuzunun efor medyanının ALTINA düşemez (taban) —
//           şekil normalize olduğundan yükseklik ayrıca korunur; "daha
//           üstlere çıkan" leveller reçete sertliği + bu tabanla gelir
// Hafızalı + karışım tutarlılık bandıdır: şablondan BAND'den fazla kaçan
// aday, bant içi aday varken seçilmez.
//
// Paket düzeni: boyut başına PACK_N level, ONLUK PARİTESİYLE şablon —
// çift onluk (1-10, 21-30, ...) "bel" (ortada zirve, sonda rahatlama),
// tek onluk (11-20, 31-40, ...) "dalga" (iki tepe; kesme hattı iki keşif
// fazı verir). spanBias bilinçli düşük (uzun koridor üretimden az gelsin),
// cornerP ve düğüm yüksek (zorluk köşe/kilitten — düğüm hissi). Etiket
// şeridi her onlukta reçete sertleşmesiyle: 3 easy, 3 medium, 2 hard,
// 2 veryhard.
//
// ÇEŞİTLİLİK (oyuncu isteği: "başlangıç kalıplarını olabildiğince
// çeşitlendir; derinlik aynı kalsın"):
//   maske    figüratif şekiller yerine dolu + simetrik prosedürel boşluklar
//            (js/generator.js symMask; V/P/Q simetri, doluluk ~%90) + seyrek
//            dama — "anlam gerekmez, simetrik görünüm yeter; genelde dolu".
//            Boşluklar giriş havuzu olduğundan maske aynı zamanda açılış
//            cephelerinin yerini de çeşitlendirir.
//   açılış   entryN 1-3 (9x14'te 4) ve frontMode yilan/cepheler/bolge
//            rotasyonu, seyrek frontBias yumuşatması — onluk içinde ve
//            onluklar arasında faz kaydırmalı, deterministik.
//   imza     AÇILIŞ İMZASI: ilk hamlelerin ölçülen karakteri (göz eforu,
//            span, köşe payı, tap konumu). Aşama A seçimi, skor bandı
//            içindeki adaylardan pakete önce girmiş levellerin imzalarına
//            EN UZAK olanı alır (uzak-nokta seçimi) — çeşitlilik reçeteye
//            değil ölçüme dayanır.

const { TM_SHAPES } = require("../js/shapes.js");
const { writePacks } = require("./pack_io.js");
const { generateFullLevel, symMask } = require("../js/generator.js");
const { isAdjacentCollinear } = require("../js/board.js");
const { effortCurve, shapeScore, CURVE_TEMPLATES, templateAt,
        spanOf, isCollinear } = require("../js/flow.js");

// boyut merdiveni: 4 basamak (funnel 1-500 bu boyutlarda çeşitlenir)
const ALL_SIZES = ["6x8", "7x10", "8x12", "9x14"];
const PACK_N = 125; // boyut başına level (4 × 125 = 500)
const SIZES = process.env.TM_SIZES ? process.env.TM_SIZES.split(",") : ALL_SIZES;
const DRY = !!process.env.TM_SIZES;

const CAND = 60;     // level başına aday tavanı (best-of-N, Aşama A)
const ACCEPT = 0.10; // erken kabul eşiği (leader — hedef fiilen oturdu)
const BAND = 0.35;   // hafızalı/karışım tutarlılık bandı (üstü elenir)
const GRIND_W = 0.4; // öğütme payının leader'daki ağırlığı
// Göz akışı: şablon VADİLERİNDE (g ≤ 0.5, akış anları) hamleler gözle
// "anında görülmeli" — göz botu eforu ≤ EYE_FAST taş. Oyuncu bulgusu:
// search pointler yakın olsa da TAŞI görmek kolay olmayabiliyor; vadide
// taş-öncelikli algıyla hızlı match istenir, tepelerde serbest (düğüm anı).
// Kalibrasyon (report_eye.js, önceki nesil): vadi hızlı-pay ~%47'ydi.
const EYE_FAST = 3;  // "anında görüş" eşiği (incelenen taş)
const EYE_W = 0.25;  // vadi yavaş-payının (1 − hızlıPay) leader ağırlığı
// Aşama B (mutasyon) değerlendirme bütçesi: board büyüdükçe artar — sorun
// büyük boardlarda (rastgele adayın uzun eğrisi şablona kendiliğinden
// oturmuyor), bütçe de oraya akar. 6x8→384, 9x15→1080, 12x18→1728.
// (Kalibrasyon: 12x18'de 432 eval 0.366→0.279 getirdi ve tırmanış doymadı.)
const mutBudget = (rows, cols) => Math.min(2000, Math.max(150, 8 * rows * cols));

const LABELS = ["easy", "easy", "easy", "medium", "medium",
                "medium", "hard", "hard", "veryhard", "veryhard"];

// Maske rotasyonu (onluk içi pozisyona göre): çoğunluk simetrik boşluklu,
// ~üçte bir dolu. Dama bel onluklarının 9. pozisyonunda, iki onlukta bir —
// yalnız desen alanı çift kalan boyutlarda (6x8, 8x12; 7x10/9x14'te dama
// 35/63 taş verir, parite onarımı tek hücre silip simetriyi bozardı).
const MASK_ROT = ["dolu", "sym-V", "sym-P", "sym-Q", "dolu",
                  "sym-P", "sym-V", "dolu", "sym-Q", "sym-V"];
function maskKindOf(tplId, d, i, rows, cols) {
  const damaOk = ((rows * cols) / 2) % 2 === 0;
  if (tplId === "bel" && i === 9 && d % 4 === 0 && damaOk) return "dama";
  return MASK_ROT[(i + d) % 10]; // onluklar arası faz kayması
}

// Reçete matrisi (i = onluk içi 0..9 sertleşme, d = onluk indeksi 0..):
// cornerP/spanBias/knots/waistOpen ("derinlik") ÖNCEKİ NESİLLE AYNI —
// çeşitlilik maske + açılış eksenlerinden gelir: entryN ve frontMode
// farklı fazlarla döner (tam korelasyon olmasın diye katsayılar farklı),
// frontBias beşte bir yumuşar (disiplinden küçük sapmalar).
function recipeOf(tplId, d, i, rows, cols) {
  const maxE = rows * cols >= 120 ? 4 : 3; // 9x14'te 4 cepheye izin
  const base = {
    maskKind: maskKindOf(tplId, d, i, rows, cols),
    entryN: 1 + (i + d) % maxE,
    frontMode: ["bolge", "yilan", "cepheler"][(i + 2 * d) % 3],
    frontBias: i % 5 === 4 ? 0.85 : 1.0,
  };
  if (tplId === "bel") {
    return {
      ...base, cut: null,
      cornerP: 0.55 + 0.03 * i, spanBias: 0.30 + 0.02 * i,
      knots: i < 4 ? 3 : 4, waistOpen: i < 6 ? 3 : 2,
    };
  }
  return {
    ...base, cut: i % 2 === 0 ? "dikey" : "yatay",
    // dama + kesme hattı bilinmedik bölge: dalga onluklarında dama yok
    maskKind: base.maskKind === "dama" ? "sym-V" : base.maskKind,
    cornerP: 0.55 + 0.025 * i, spanBias: 0.32 + 0.02 * i,
    knots: Math.min(4, 3 + Math.floor(i / 4)), waistOpen: null,
  };
}

// maske adları (level name alanı yalnız konsol/inceleme içindir)
const MASK_NAMES = { dolu: "Dolu", dama: "Satranç",
  "sym-V": "Simetrik·V", "sym-P": "Simetrik·P", "sym-Q": "Simetrik·Q" };

function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Tek aday: maske türünden maske üretilir (sym maskeleri aday seedine
// bağlı — her aday farklı boşluk yerleşimi dener, havuz maskede de
// çeşitlenir). Kesme tutmazsa fallback: diğer yön → dolu+dikey; maske
// inşayı tıkarsa dolu.
function genCandidate(rows, cols, rec, seed) {
  const maskFrom = (kind) =>
    kind === "dolu" ? null
    : kind === "dama" ? TM_SHAPES.maskFor("satranc", rows, cols)
    : symMask(rows, cols, (seed ^ 0x5bd1e995) >>> 0, kind.slice(4));
  const tries = rec.cut
    ? [{ kind: rec.maskKind, cut: rec.cut },
       { kind: rec.maskKind, cut: rec.cut === "dikey" ? "yatay" : "dikey" },
       { kind: "dolu", cut: "dikey" }]
    : [{ kind: rec.maskKind, cut: null },
       { kind: "dolu", cut: null }];
  for (const t of tries) {
    const lv = generateFullLevel({
      rows, cols, mask: maskFrom(t.kind), seed,
      entryN: rec.entryN, frontMode: rec.frontMode, frontBias: rec.frontBias,
      cornerP: rec.cornerP, spanBias: rec.spanBias,
      knots: rec.knots, waistOpen: rec.waistOpen, cut: t.cut,
    });
    if (lv) return { lv, maskKind: t.kind, cut: t.cut };
  }
  return null;
}

// ── Açılış imzası: ilk SIG_K hamlenin ölçülen karakteri ─────────────────
// 0..1 bileşenler: [göz eforu (taş sayısına oranla), ort span (uzun kenara
// oranla), köşe payı, tap konumu satır, tap konumu sütun]. Uzak-nokta
// seçimi bu uzayda çalışır — "başlangıç kalıbı" reçeteyle değil oyunun
// ilk hamlelerinin ölçümüyle tanımlanır.
const SIG_K = 6;
function sigOf(ecS, ecE, pairs, rows, cols) {
  const K = Math.min(SIG_K, ecS.moves.length);
  const maxDim = Math.max(rows, cols);
  let eye = 0, span = 0, corner = 0, np = 0, pr = 0, pc = 0;
  for (let t = 0; t < K; t++) {
    const mv = ecS.moves[t];
    pr += mv.r / (rows - 1);
    pc += mv.c / (cols - 1);
    for (const pid of mv.pairIds) {
      span += spanOf(pairs[pid]) / maxDim;
      corner += isCollinear(pairs[pid]) ? 0 : 1;
      np++;
    }
    eye += Math.min(1, ecE.effort[Math.min(t, ecE.effort.length - 1)] / (pairs.length * 2));
  }
  return [eye / K, span / np, corner / np, pr / K, pc / K];
}
const sigDist = (a, b) =>
  Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) * (x - b[i]), 0) / a.length);

// Öğütme payı: art arda "uzun mesafe match" — hamlenin kırdığı tüm çiftler
// span ≥ uzun kenarın yarısı ise hamle "uzun"dur (hizalı ŞART DEĞİL: eski
// 8x12 paketinde uzun matchlerin çoğu köşeydi, %30 pay 7+ span köşe);
// art arda gelen uzun hamlelerin toplam payı döner. Tek başına bir uzun
// match ceza yemez — sorun ÜST ÜSTE gelmesi (akma/düğüm hissine hizmet
// etmeyen amelelik). Kalibrasyon: eski paketlerde bu pay %36-44 çıkıyordu.
function grindShare(ecS, pairs, rows, cols) {
  const LONG = Math.ceil(0.5 * Math.max(rows, cols));
  const L = ecS.moves.length;
  const isLong = ecS.moves.map((m) =>
    m.pairIds.every((pid) => spanOf(pairs[pid]) >= LONG));
  let n = 0;
  for (let t = 0; t < L; t++) {
    if (isLong[t] && ((t > 0 && isLong[t - 1]) || (t + 1 < L && isLong[t + 1]))) n++;
  }
  return n / L;
}

// Şablon vadilerinde göz botunun hızlı-görüş payı (≤ EYE_FAST taş).
// Vadi = eğrinin kendi t ekseninde g(t) ≤ 0.5 olan adımlar.
function valleyFastShare(ecE, tpl) {
  const L = ecE.effort.length;
  let v = 0, fast = 0;
  ecE.effort.forEach((e, i) => {
    if (templateAt(tpl, L > 1 ? i / (L - 1) : 0) <= 0.5) {
      v++;
      if (e <= EYE_FAST) fast++;
    }
  });
  return v ? fast / v : 1;
}

// Öncü değerlendirme (sweep+ray+göz): leader = şekil RMSE ort. + öğütme
// cezası + vadi yavaş-görüş cezası. meanEffort = yerel botun ortalama
// eforu (efor tabanı bununla uygulanır). Bot çözemezse (tıkalı) → null.
function leaderOf(pairs, rows, cols, tpl) {
  const ecS = effortCurve(pairs, rows, cols, null, "sweep");
  if (!ecS) return null;
  const ecR = effortCurve(pairs, rows, cols, null, "ray");
  if (!ecR) return null;
  const ecE = effortCurve(pairs, rows, cols, null, "eye");
  if (!ecE) return null;
  const fit = (shapeScore(ecS.effort, tpl) + shapeScore(ecR.effort, tpl)) / 2;
  const grind = grindShare(ecS, pairs, rows, cols);
  const vfs = valleyFastShare(ecE, tpl);
  return {
    leader: fit + GRIND_W * grind + EYE_W * (1 - vfs),
    fit, grind, vfs, meanEffort: ecS.effortMean, ecS,
    sig: sigOf(ecS, ecE, pairs, rows, cols),
  };
}

// Tam aday skoru (Aşama A): öncü + tutarlılık bandı. Bandı aşan aday
// elenmez ama ağır ceza yer (key) — bant içi aday varken asla seçilmez,
// hiç yoksa en az kaçanı son çare olur.
function scoreLevel(pairs, rows, cols, tpl) {
  const ls = leaderOf(pairs, rows, cols, tpl);
  if (!ls) return null;
  const band = bandOf(pairs, rows, cols, tpl);
  if (band === null) return null;
  return { ...ls, band, key: ls.leader + (band > BAND ? 100 + band : 0) };
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

// bant (hafızalı/karışım maks RMSE) — mutasyonda yalnız iyileşme
// adaylarında koşar (eval maliyeti 4 yerine 2 bot)
function bandOf(pairs, rows, cols, tpl) {
  let band = 0;
  for (const m of ["memory", "mix"]) {
    const ec = effortCurve(pairs, rows, cols, null, m);
    if (!ec) return null;
    band = Math.max(band, shapeScore(ec.effort, tpl));
  }
  return band;
}

// floor = efor tabanı: mutasyon şablona uydururken leveli UCUZLATAMAZ
// (yerel botun ortalama eforu tabanın altına inen aday reddedilir).
function refine(start, rows, cols, tpl, rng, floor) {
  let cur = start; // leaderOf çıktısı + { pairs, band }
  let accepted = 0;
  const budget = mutBudget(rows, cols);
  for (let evals = 0; evals < budget && cur.leader > ACCEPT; evals++) {
    const next = mutateOnce(cur.pairs, rng, guidePairs(cur.ecS, tpl));
    if (!next) continue; // yasak yerleşim — bütçe yine işler (deterministik)
    const ls = leaderOf(next, rows, cols, tpl);
    if (!ls || ls.leader >= cur.leader - 1e-9 || ls.meanEffort < floor) continue;
    const nb = bandOf(next, rows, cols, tpl);
    if (nb === null || nb > Math.max(BAND, cur.band)) continue;
    cur = { ...ls, pairs: next, band: nb };
    accepted++;
  }
  return { ...cur, accepted };
}

// uzak-nokta seçim bandı: en iyi skora bu kadar yakın adaylar kalite
// olarak eşdeğer sayılır — aralarından açılış imzası pakete en uzak seçilir
const DIV_BAND = 0.05;

function buildPack(sizeStr) {
  const [cols, rows] = sizeStr.split("x").map(Number);
  const levels = [];
  const stats = { bel: [], dalga: [], before: [], efor: [], grind: [],
                  goz: [], sigd: [], bandOut: 0 };
  const chosenSigs = []; // paket içinde seçilmiş levellerin açılış imzaları
  for (let id = 1; id <= PACK_N; id++) {
    const d = Math.floor((id - 1) / 10); // onluk indeksi
    const tplId = d % 2 === 0 ? "bel" : "dalga"; // onluk paritesi
    const tpl = CURVE_TEMPLATES[tplId];
    const i = (id - 1) % 10;
    const rec = recipeOf(tplId, d, i, rows, cols);
    // Aşama A: aday havuzu — efor tabanı havuzdan türediği için (medyan)
    // erken çıkış yok, tüm adaylar toplanır
    const pool = [];
    for (let cand = 0; cand < CAND; cand++) {
      const g = genCandidate(rows, cols, rec, hashSeed("efor:" + sizeStr + ":" + id + ":" + cand));
      if (!g) continue;
      const sc = scoreLevel(g.lv.pairs, rows, cols, tpl);
      if (sc) pool.push({ g, sc, cand });
    }
    if (!pool.length) throw new Error("aday bulunamadı: " + sizeStr + " #" + id);
    // efor tabanı: havuz medyanı — level kendi havuzunun ucuz yarısına
    // düşemez ("efor olarak daha üstlere"); şekil bu tabanın üstünde seçilir
    const means = pool.map((p) => p.sc.meanEffort).sort((a, b) => a - b);
    const floor = means[Math.floor(means.length / 2)];
    const eligible = pool.filter((p) => p.sc.meanEffort >= floor);
    // seçim: kalite bandı içinden AÇILIŞ İMZASI pakete en uzak aday
    // (uzak-nokta örneklemesi). Sıralama key→cand deterministik; eşit
    // uzaklıkta düşük key kazanır (liste o sırayla gezilir).
    const list = (eligible.length ? eligible : pool)
      .slice().sort((a, b) => a.sc.key - b.sc.key || a.cand - b.cand);
    const elite = list.filter((p) => p.sc.key <= list[0].sc.key + DIV_BAND);
    let best = elite[0], bestD = -1;
    if (chosenSigs.length) {
      for (const p of elite) {
        const dMin = Math.min(...chosenSigs.map((s) => sigDist(p.sc.sig, s)));
        if (dMin > bestD + 1e-12) { bestD = dMin; best = p; }
      }
    }
    const { lv } = best.g;
    // sözleşme: %100 dolu (generateFullLevel garantisi; yine de doğrula)
    if (lv.pairs.length * 2 !== lv.maskArea) throw new Error("doluluk bozuk: " + sizeStr + " #" + id);

    // Aşama B: en iyi adayı mutasyonla şablona doğru it (efor tabanı korunur)
    stats.before.push(best.sc.leader);
    const ref = refine(
      { ...best.sc, pairs: lv.pairs },
      rows, cols, tpl, mulberry32(hashSeed("efor-mut:" + sizeStr + ":" + id)), floor);
    if (ref.band > BAND) stats.bandOut++;
    // mutasyon sözleşmesi: çift sayısı aynı, tüm hücreler benzersiz (tam dolu)
    const cellSet = new Set(ref.pairs.flat().map(([r, c]) => r * cols + c));
    if (ref.pairs.length !== lv.pairs.length || cellSet.size !== ref.pairs.length * 2) {
      throw new Error("mutasyon doluluğu bozdu: " + sizeStr + " #" + id);
    }
    // meta için bileşenler son halden ölçülür; imza havuza SON halden girer
    // (mutasyon açılışı az değiştirir ama ölçüm gerçeği yazsın)
    if (chosenSigs.length) stats.sigd.push(
      Math.min(...chosenSigs.map((s) => sigDist(ref.sig, s))));
    chosenSigs.push(ref.sig);
    const ecS = effortCurve(ref.pairs, rows, cols, null, "sweep");
    const ecR = effortCurve(ref.pairs, rows, cols, null, "ray");
    stats[tplId].push(ref.leader);
    stats.efor.push(ref.meanEffort);
    stats.grind.push(ref.grind);
    stats.goz.push(ref.vfs);
    levels.push({
      id,
      name: MASK_NAMES[best.g.maskKind] + " · " + tplId,
      rows, cols,
      pairs: ref.pairs,
      seed: lv.seed,
      meta: {
        label: LABELS[i],
        template: tplId,
        mask: best.g.maskKind,
        cut: best.g.cut,
        entryN: rec.entryN,
        frontMode: rec.frontMode,
        score: +ref.leader.toFixed(3),
        sweepRmse: +shapeScore(ecS.effort, tpl).toFixed(3),
        rayRmse: +shapeScore(ecR.effort, tpl).toFixed(3),
        bandRmse: +ref.band.toFixed(3),
        eforOrt: +ref.meanEffort.toFixed(1),
        grind: +ref.grind.toFixed(3),
        gozPay: +ref.vfs.toFixed(3),
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
  const mutN = pack.levels.reduce((a, l) => a + l.meta.mut, 0);
  console.log(
    s.padEnd(7) +
    "bel " + mean(stats.bel).toFixed(3) + "  " +
    "dalga " + mean(stats.dalga).toFixed(3) + "  " +
    "A→B " + mean(stats.before).toFixed(3) + "→" +
    mean(stats.bel.concat(stats.dalga)).toFixed(3) +
    " (" + mutN + " mut)  " +
    "efor ort " + mean(stats.efor).toFixed(1) + "  " +
    "öğütme " + (100 * mean(stats.grind)).toFixed(1) + "%  " +
    "göz payı " + (100 * mean(stats.goz)).toFixed(0) + "%  " +
    "imza çeş. " + mean(stats.sigd).toFixed(3) + "  " +
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
      "// CURVE_TEMPLATES, onluk paritesiyle (çift onluk bel, tek dalga).\n\n",
  });
  console.log("yazıldı: levels/efor-<boyut>/*.json + levels_efor.js (" +
    packs.length + " paket, " +
    packs.reduce((a, p) => a + p.levels.length, 0) + " level, sarmalayıcı " +
    r.jsKb + " KB)");
}
