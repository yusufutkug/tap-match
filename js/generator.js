"use strict";

// Tap Match — yapı-önce level üretimi.
//
// Hedef akış: düğüm→zincir + U-kavisi. Roller:
//   GİRİŞ  (entryN): kısa hizalı çiftler, dalga-0 — U'nun sol kolu.
//   KAPI   (gateN):  derin zincir(ler), dibi dalga-0 — belin omurgası.
//   KİLİTLİ (lockedN): derin zincirler; dipleri DOĞUŞTAN KİLİTLİ doğar —
//                    dip, açılma bölgesinde hâlihazırda başka zincirin taşı
//                    olan çift olarak seçilir (kapı taşı ya da önceki kilitli
//                    taşı → geçişli olarak yine kapı). Kapı söküldükçe
//                    kilitliler kademeli açılır (hasat).
//
// Mimari not: ilk sürüm ttm gibi "kapı büyürken mustFill hücrelerini örter"
// yaklaşımını taşıyordu; tap match'te zincir çocukları kilit bölgelerine
// (koridor/köşe öldürme hücreleri) hapsolduğundan kapı hedefe yürüyemedi ve
// büyük boardlarda üretim ölçeklenmedi. Bu sürüm ters çevirir: KAPI ÖNCE
// kurulur (örtme görevi yok — boş boardda kolay), kilitli dipler sonradan
// mevcut taşların gölgesine yerleştirilir. Kimse kimseyi kovalamaz.
//
// Tersten inşa değişmezi: dipler hariç HER çift yerleştiği anda mevcut
// boardda AÇIK olmalı (openNow) — sonra konan çocuk onu kilitler; sonra konan
// önce oynanır. Kilit ilkelleri:
//   hizalı ebeveyn  → çocuğun bir taşı koridora oturur.
//   hizasız ebeveyn → iki köşe de canlıysa çocuk taşları ikisini birden
//                     öldürür; tek köşe canlıysa (diğerini önce konan taşlar
//                     öldürmüş) tek taş yeter. Çapraz kilit istisnası: çocuk
//                     tam iki köşe hücresine oturamaz (karşılıklı deadlock).
// Kendi zincirinin taşı dip blokeri OLAMAZ (dip kendi kaskadını beklerdi).
//
// Doğrulama güvenlik ağıdır: her aday pairsCurve (çözülebilirlik + U metrik)
// ve analyzeFlow (dalga-0 = tasarım) süzgecinden geçer. İnşa sezgiseldir,
// garanti ölçümden gelir. Deterministiktir (seed → level).

if (typeof module !== "undefined" && typeof boardFromPairs === "undefined") {
  var { boardFromPairs } = require("./board.js");
  var { analyzeFlow, pairsCurve, pairOptions, spanOf, isCollinear } = require("./flow.js");
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
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

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const DIRS4 = [[0, 1], [0, -1], [1, 0], [-1, 0]];

// Tek geometri denemesi. Başarısızlıkta null (o.fail verilirse neden sayılır).
function buildGeometry(rng, o) {
  const { rows, cols, entryN, lockedN, depthMin, depthMax, cornerP } = o;
  const gateN = Math.max(1, o.gateN | 0 || 1);
  // Kapı halkalarının köşe (hizasız) olasılığı — kilitlilerden ayrı: hizalı
  // halkanın çocuk adayları geniştir, kapı çevik kalır; köşe eforu kilitliler
  // ve kapının arada kalan hizasız halkalarından gelir.
  const gateCornerP = o.gateCornerP === undefined ? 0.35 : o.gateCornerP;
  const die = (k) => { if (o.fail) o.fail[k] = (o.fail[k] || 0) + 1; return null; };

  const grid = Array.from({ length: rows }, () => Array(cols).fill(null)); // çift indeksi
  const pairs = []; // { cells, role, chain }
  const reserved = new Set(); // sonsuza dek boş: dip koridorları + kapı koridor artıkları
  const gateDipZones = []; // kapı diplerinin rezerve bölgeleri (fitil hedefleri)
  let guard = rows * cols * 40;
  let chainSeq = -1;

  const K = (r, c) => r + "," + c;
  const inb = (r, c) => r >= 0 && c >= 0 && r < rows && c < cols;
  const emptyCell = (r, c) => grid[r][c] === null;
  const canHost = (r, c) => inb(r, c) && emptyCell(r, c) && !reserved.has(K(r, c));

  // Uçlar hariç arası boş mu (rezerve hücre boş sayılır — hep boş kalacak)
  function segClear(r1, c1, r2, c2) {
    if (r1 === r2) {
      for (let c = Math.min(c1, c2) + 1; c < Math.max(c1, c2); c++) if (!emptyCell(r1, c)) return false;
    } else {
      for (let r = Math.min(r1, r2) + 1; r < Math.max(r1, r2); r++) if (!emptyCell(r, c1)) return false;
    }
    return true;
  }

  // Çift ŞU AN açık mı? (dipler hariç yerleştirme disiplini)
  function openNow(t1, t2) {
    const [r1, c1] = t1, [r2, c2] = t2;
    if (r1 === r2 || c1 === c2) {
      return Math.abs(r1 - r2) + Math.abs(c1 - c2) >= 2 && segClear(r1, c1, r2, c2);
    }
    for (const [kr, kc] of [[r1, c2], [r2, c1]]) {
      if (emptyCell(kr, kc) && segClear(kr, kc, r1, c1) && segClear(kr, kc, r2, c2)) return true;
    }
    return false;
  }

  function place(t1, t2, role, chain) {
    const i = pairs.length;
    pairs.push({ cells: [t1, t2], role, chain });
    grid[t1[0]][t1[1]] = i;
    grid[t2[0]][t2[1]] = i;
    return i;
  }
  function unplaceLast() {
    const p = pairs.pop();
    for (const [r, c] of p.cells) grid[r][c] = null;
  }

  function corridorCells([r1, c1], [r2, c2]) {
    const out = [];
    if (r1 === r2) { for (let c = Math.min(c1, c2) + 1; c < Math.max(c1, c2); c++) out.push([r1, c]); }
    else { for (let r = Math.min(r1, r2) + 1; r < Math.max(r1, r2); r++) out.push([r, c1]); }
    return out;
  }

  // m'den 4 yönde hizalı partner adayları (span sMin..sMax, arası boş).
  // Rezerve hücre partner OLAMAZ ama üstünden geçilebilir (boş kalır).
  function alignedPartners(m, sMin, sMax) {
    const out = [];
    for (const [dr, dc] of DIRS4) {
      for (let s = 1; s <= sMax; s++) {
        const r = m[0] + dr * s, c = m[1] + dc * s;
        if (!inb(r, c) || !emptyCell(r, c)) break;
        if (s >= sMin && canHost(r, c)) out.push([r, c]);
      }
    }
    return out;
  }

  // m çevresinde hizasız partner adayları (her iki eksende 1..reach ofset)
  function diagonalPartners(m, reach) {
    const out = [];
    for (let dr = -reach; dr <= reach; dr++) {
      for (let dc = -reach; dc <= reach; dc++) {
        if (dr === 0 || dc === 0) continue;
        const r = m[0] + dr, c = m[1] + dc;
        if (canHost(r, c)) out.push([r, c]);
      }
    }
    return out;
  }

  // Köşeyi öldürebilecek hücreler: köşenin kendisi + iki bacağın araları.
  function killCells(corner, tiles) {
    const out = [];
    if (canHost(corner[0], corner[1])) out.push(corner.slice());
    for (const [tr, tc] of tiles) {
      if (tr === corner[0]) {
        for (let c = Math.min(tc, corner[1]) + 1; c < Math.max(tc, corner[1]); c++) {
          if (canHost(tr, c)) out.push([tr, c]);
        }
      } else {
        for (let r = Math.min(tr, corner[0]) + 1; r < Math.max(tr, corner[0]); r++) {
          if (canHost(r, tc)) out.push([r, tc]);
        }
      }
    }
    return out;
  }

  // Köşe seçeneği şu an canlı mı? (köşe hücresi boş + iki bacak temiz)
  function cornerAlive(corner, [A, B]) {
    return emptyCell(corner[0], corner[1]) &&
      segClear(corner[0], corner[1], A[0], A[1]) &&
      segClear(corner[0], corner[1], B[0], B[1]);
  }

  // Köşenin öldürme bölgesi anahtar listesi (kapı dibi rezervi için)
  function cornerZone(corner, tiles) {
    const keys = [K(corner[0], corner[1])];
    for (const [tr, tc] of tiles) {
      if (tr === corner[0]) {
        for (let c = Math.min(tc, corner[1]) + 1; c < Math.max(tc, corner[1]); c++) keys.push(K(tr, c));
      } else {
        for (let r = Math.min(tr, corner[0]) + 1; r < Math.max(tr, corner[0]); r++) keys.push(K(r, tc));
      }
    }
    return keys;
  }

  // Ebeveyni kilitleyen open-now çocuk adayları. Dönüş [[t1,t2],...] karışık.
  function childCandidates(parent) {
    const [A, B] = parent.cells;
    const raw = [];
    if (isCollinear(parent.cells)) {
      for (const m of corridorCells(A, B)) {
        if (!canHost(m[0], m[1])) continue;
        for (const p of alignedPartners(m, 2, Math.max(rows, cols))) raw.push([m, p]);
        for (const p of diagonalPartners(m, 4)) raw.push([m, p]);
      }
    } else {
      const [r1, c1] = A, [r2, c2] = B;
      const X = [r1, c2], Y = [r2, c1];
      const aliveX = cornerAlive(X, parent.cells), aliveY = cornerAlive(Y, parent.cells);
      if (aliveX && aliveY) {
        const kx = killCells(X, [A, B]);
        const ky = killCells(Y, [A, B]);
        for (const t1 of kx) {
          for (const t2 of ky) {
            if (t1[0] === t2[0] && t1[1] === t2[1]) continue;
            // çapraz kilit yasağı: çocuk tam iki köşe hücresine oturamaz
            if (t1[0] === X[0] && t1[1] === X[1] && t2[0] === Y[0] && t2[1] === Y[1]) continue;
            raw.push([t1, t2]);
          }
        }
      } else if (aliveX || aliveY) {
        // tek köşe canlı: tek taş yeter, partner serbest
        const alive = aliveX ? X : Y;
        for (const t1 of killCells(alive, [A, B])) {
          for (const p of alignedPartners(t1, 2, Math.max(rows, cols))) raw.push([t1, p]);
          for (const p of diagonalPartners(t1, 4)) raw.push([t1, p]);
        }
      }
      // iki köşe de ölü: ebeveyn zaten başkalarına kilitli — halka örülmez
    }
    const ok = [];
    for (const [t1, t2] of raw) {
      if (t1[0] === t2[0] && t1[1] === t2[1]) continue;
      if ((t1[0] === t2[0] || t1[1] === t2[1]) && spanOf([t1, t2]) < 2) continue;
      if (!openNow(t1, t2)) continue;
      ok.push([t1, t2]);
    }
    return shuffle(ok, rng);
  }

  // Rastgele open-now tepe çifti; near verilirse yakını yeğlenir
  // (kilitli zincirler kapı hattı boyunca dağılsın diye).
  function topCandidate(preferCorner, near) {
    let best = null, bestD = Infinity, found = 0;
    for (let t = 0; t < 60 && found < 8; t++) {
      const r = Math.floor(rng() * rows), c = Math.floor(rng() * cols);
      if (!canHost(r, c)) continue;
      const wantCorner = rng() < (preferCorner ? cornerP : 0.25);
      const partners = wantCorner
        ? diagonalPartners([r, c], 4)
        : alignedPartners([r, c], 2, Math.max(rows, cols));
      shuffle(partners, rng);
      for (const p of partners) {
        if (!openNow([r, c], p)) continue;
        found++;
        // çapaya "halka" mesafesi: dibe yapışmak boğar, uzak kalmak bloker
        // erişimini keser — tatlı nokta ~4-5 hücre
        const d = near
          ? Math.abs(Math.abs(r - near[0]) + Math.abs(c - near[1]) - 4)
          : rng();
        if (d < bestD) { bestD = d; best = [[r, c], p]; }
        break;
      }
    }
    return best;
  }

  // Kapı dibi: son halkayı kilitleyen open-now çift; açık kalma garantisi
  // rezervasyonla (dalga-0). Hizalı span2-3 → koridor rezerve; hizasız küçük
  // dikdörtgen → açık bir köşe bölgesi komple rezerve.
  function tryGateDip(parent, chain) {
    const cands = childCandidates(parent).filter(([t1, t2]) => {
      if (t1[0] === t2[0] || t1[1] === t2[1]) return spanOf([t1, t2]) <= 3;
      return Math.abs(t1[0] - t2[0]) <= 2 && Math.abs(t1[1] - t2[1]) <= 2;
    });
    const kindOf = (x) => (x[0][0] === x[1][0] || x[0][1] === x[1][1]) ? 0 : 1;
    cands.sort((a, b) => kindOf(a) - kindOf(b)); // hizalı önce (rezervi küçük)
    for (const [d1, d2] of cands) {
      if (d1[0] === d2[0] || d1[1] === d2[1]) {
        place(d1, d2, "gate", chain);
        const keys = corridorCells(d1, d2).map(([r, c]) => K(r, c));
        for (const k of keys) reserved.add(k);
        gateDipZones.push(keys);
        return true;
      }
      const zones = [cornerZone([d1[0], d2[1]], [d1, d2]), cornerZone([d2[0], d1[1]], [d1, d2])];
      const openZone = zones.find((z) =>
        z.every((k) => { const [r, c] = k.split(",").map(Number); return emptyCell(r, c); }));
      if (!openZone) continue;
      place(d1, d2, "gate", chain);
      for (const k of openZone) reserved.add(k);
      gateDipZones.push(openZone.slice());
      return true;
    }
    return false;
  }

  // Kilitli dip: DOĞUŞTAN KİLİTLİ hizalı çift — ebeveyni kilitler VE
  // koridorunda başka zincirin taşı (kapı ya da önceki kilitli) vardır.
  // Kendi zincirinin taşı bloker olamaz (kendi kaskadını beklerdi).
  function lockedDipCands(parent, chain) {
    const out = [];
    const scanFrom = (t1, requireKeys) => {
      for (const [dr, dc] of DIRS4) {
        let blocked = false;
        for (let s = 1; s <= 8; s++) {
          const r = t1[0] + dr * s, c = t1[1] + dc * s;
          if (!inb(r, c)) break;
          if (!emptyCell(r, c)) {
            if (pairs[grid[r][c]].chain === chain) break; // kendi taşı: ötesi geçersiz
            blocked = true;
            continue;
          }
          if (!canHost(r, c)) continue; // rezerve: konamaz ama segment sürer
          if (blocked && (!requireKeys || requireKeys.has(K(r, c)))) {
            out.push([t1.slice(), [r, c]]);
          }
        }
      }
    };
    const [A, B] = parent.cells;
    if (isCollinear(parent.cells)) {
      for (const m of corridorCells(A, B)) {
        if (canHost(m[0], m[1])) scanFrom(m, null);
      }
    } else {
      const X = [A[0], B[1]], Y = [B[0], A[1]];
      const aliveX = cornerAlive(X, parent.cells), aliveY = cornerAlive(Y, parent.cells);
      if (aliveX && aliveY) {
        const kx = killCells(X, [A, B]), ky = killCells(Y, [A, B]);
        const kxKeys = new Set(kx.map(([r, c]) => K(r, c)));
        const kyKeys = new Set(ky.map(([r, c]) => K(r, c)));
        for (const t1 of kx) scanFrom(t1, kyKeys);
        for (const t1 of ky) scanFrom(t1, kxKeys);
      } else if (aliveX || aliveY) {
        for (const t1 of killCells(aliveX ? X : Y, [A, B])) scanFrom(t1, null);
      }
    }
    return shuffle(out, rng);
  }

  // Zincir kurar: top → halkalar → dip. Sıkışan zincir komple silinip
  // yeniden kurulur (inşa sırasında araya başka taş girmez — sökme güvenli).
  // nearFn: her denemede taze çapa (kalabalık bölgeye saplanmayı önler).
  function buildChain(role, dTarget, nearFn) {
    for (let t = 0; t < 6; t++) {
      const links = buildChainOnce(role, dTarget, nearFn ? nearFn() : null);
      if (links) return links;
      if (guard <= 0) return null;
    }
    return die(role + "-chain");
  }

  function buildChainOnce(role, dTarget, near) {
    const chain = ++chainSeq;
    const links = [];
    const fail = (why) => {
      if (o.fail) { const k = role + "." + why; o.fail[k] = (o.fail[k] || 0) + 1; }
      while (links.length) { unplaceLast(); links.pop(); }
      return null;
    };
    if (--guard <= 0) return fail("guard");
    const top = topCandidate(role === "gate", near);
    if (!top) return fail("top");
    links.push(place(top[0], top[1], role, chain));
    let undoBudget = 8;
    let topBudget = 4; // tepe çocuksuz kaldıysa başka yere kurulabilir
    const maxLen = dTarget + 4;

    while (links.length < maxLen) {
      if (--guard <= 0) return fail("guard");
      const parent = pairs[links[links.length - 1]];
      if (links.length >= dTarget - 1) {
        // dip dene; olmuyorsa büyümeye devam (yeni ebeveyn yeni dip şansı)
        if (role === "gate") {
          if (tryGateDip(parent, chain)) { links.push(pairs.length - 1); return links; }
        } else {
          const dips = lockedDipCands(parent, chain);
          if (dips.length) {
            const [d1, d2] = dips[0];
            links.push(place(d1, d2, "locked", chain));
            return links;
          }
        }
      }
      let cands = childCandidates(parent);
      if (rng() < (role === "gate" ? gateCornerP : cornerP)) {
        // köşe eşleşmesi tercihi: hizasız çocuk
        const diag = cands.filter(([t1, t2]) => t1[0] !== t2[0] && t1[1] !== t2[1]);
        if (diag.length) cands = diag;
      }
      if (!cands.length) {
        // geri sar: son halkayı sök, ebeveyn başka yöne büyüsün
        if (links.length > 1 && undoBudget-- > 0) {
          unplaceLast();
          links.pop();
          continue;
        }
        // tepe çocuksuz: başka yere kur
        if (links.length === 1 && topBudget-- > 0) {
          unplaceLast();
          links.pop();
          const t = topCandidate(role === "gate", near);
          if (!t) return fail("retop");
          links.push(place(t[0], t[1], role, chain));
          continue;
        }
        return fail("grow@" + links.length);
      }
      const [t1, t2] = cands[0];
      links.push(place(t1, t2, role, chain));
    }
    return fail("maxlen(dip)");
  }

  // Zincir bitince her halka için İLERİ-YÖNLÜ BİR açılma yolu rezerve
  // edilir: sonradan konan bir taş önceki zincirin bölgesine oturursa o
  // halka geç konan (erken oynanması gereken) zincire bağımlı olur →
  // geriye dönük kenar → döngü/deadlock (çok kapılıda %100 görüldü).
  // Hizalı halkada tek yol var (koridor). Hizasızda tek köşe yeter:
  // "güvenli" köşe = bölgesinde yalnız kendi zincirinin taşları (çocuklar,
  // hepsi halkadan önce oynanır) olan köşe; öbür köşe serbest bırakılır
  // (kirlenirse de rezerve yol halkayı açar).
  function reserveChainZones(links) {
    for (const idx of links) {
      const p = pairs[idx];
      const [A, B] = p.cells;
      if (isCollinear(p.cells)) {
        for (const [r, c] of corridorCells(A, B)) {
          if (emptyCell(r, c)) reserved.add(K(r, c));
        }
      } else {
        let bestZone = null, bestCost = Infinity;
        for (const corner of [[A[0], B[1]], [B[0], A[1]]]) {
          const zone = cornerZone(corner, [A, B]);
          let cost = 0, safe = true;
          for (const k of zone) {
            const [r, c] = k.split(",").map(Number);
            if (emptyCell(r, c)) cost++;
            else if (pairs[grid[r][c]].chain !== p.chain) { safe = false; break; }
          }
          if (safe && cost < bestCost) { bestCost = cost; bestZone = zone; }
        }
        if (bestZone) {
          for (const k of bestZone) {
            const [r, c] = k.split(",").map(Number);
            if (emptyCell(r, c)) reserved.add(k);
          }
        }
      }
    }
  }

  // ── İnşa sırası: kapılar → kilitliler → girişler ──
  // (sonra konan önce oynanır: girişler en önce, kapı tepesi en son)

  const gateDepths = [];
  for (let g = 0; g < gateN; g++) {
    const target = depthMin + Math.floor(rng() * (depthMax - depthMin + 1));
    const links = buildChain("gate", target, null);
    if (!links) return null;
    gateDepths.push(links.length);
    reserveChainZones(links);
  }

  const lockedDepths = [];
  const gatePairs = pairs.filter((p) => p.role === "gate");
  // kilitliler kapı hatları boyunca dağılsın: her denemede taze kapı çapası
  const anchorFn = () => {
    const gp = gatePairs[Math.floor(rng() * gatePairs.length)];
    return gp.cells[Math.floor(rng() * 2)];
  };
  // kalabalıkta tek tük zincir kurulamayabilir — küçük kota ile atlanır
  let skipped = 0;
  const skipQuota = Math.max(1, Math.floor(lockedN / 3));
  for (let i = 0; i < lockedN; i++) {
    const d = depthMin + Math.floor(rng() * (depthMax - depthMin + 1));
    const links = buildChain("locked", d, anchorFn);
    if (!links) {
      if (++skipped > skipQuota) return die("locked-quota");
      continue;
    }
    lockedDepths.push(links.length);
    reserveChainZones(links);
  }

  // ── Girişler ──
  // "Etkisiz giriş" düzeltmesi: eski sürüm girişleri boarda yayıp nötr
  // boşluğa koyuyordu — rezervasyon duvarı yüzünden hiçbir çiftin açılma
  // bölgesine giremiyorlar, dolayısıyla kaldırılmaları hiçbir şey açmıyordu
  // (pakette girişlerin %56'sı ölü içerikti). Artık üç kademeli:
  //   1) FİTİL: her kapı dibinin rezerve bölgesinden BİR hücreye giriş taşı
  //      oturur → kapı ancak fitil tapıyla açılır (anında görünür etki).
  //      O kapı dibi artık dalga-0 değil (giriş sayımı buna göre düzelir).
  //   2) BAĞLI: kalan girişlerin bir taşı, hizasız bir zincir halkasının
  //      REZERVE EDİLMEMİŞ köşe bölgesine oturur → girişin kalkması o köşe
  //      seçeneğini gerçekten açar (outDeg ≥ 1). Halkanın garanti yolu
  //      rezerve tarafta olduğundan döngü/deadlock riski yok.
  //   3) SERBEST: bağlantı bulunamazsa eski yayılmış yerleşim (etkisiz
  //      kalabilir — generateLevel inertShare ile cezalandırır).
  const mids = [];

  function placeEntry(t1, p) {
    place(t1, p, "entry", ++chainSeq);
    // giriş koridoru boş kalmalı (dalga-0 garantisi)
    for (const [r, c] of corridorCells(t1, p)) reserved.add(K(r, c));
    mids.push([(t1[0] + p[0]) / 2, (t1[1] + p[1]) / 2]);
  }

  // t1'i verilen hücrelerden birine oturt; partner hizalı span 2-4, open-now
  function tryAttachedEntry(cells, isFuse) {
    shuffle(cells, rng);
    for (const [r, c] of cells.slice(0, 60)) {
      if (isFuse ? !emptyCell(r, c) : !canHost(r, c)) continue;
      if (isFuse) reserved.delete(K(r, c)); // bilinçli istisna: fitil dibe oturur
      const partners = alignedPartners([r, c], 2, 4).filter((p) => openNow([r, c], p));
      if (!partners.length) {
        if (isFuse) reserved.add(K(r, c));
        continue;
      }
      placeEntry([r, c], partners[Math.floor(rng() * partners.length)]);
      return true;
    }
    return false;
  }

  // bağlantı hedefleri: hizasız zincir halkalarının rezerve edilmemiş,
  // boş köşe bölgesi hücreleri
  function attachTargets() {
    const out = [];
    for (const p of pairs) {
      if (p.role === "entry" || isCollinear(p.cells)) continue;
      const [A, B] = p.cells;
      for (const corner of [[A[0], B[1]], [B[0], A[1]]]) {
        for (const k of cornerZone(corner, [A, B])) {
          const [r, c] = k.split(",").map(Number);
          if (emptyCell(r, c) && !reserved.has(k)) out.push([r, c]);
        }
      }
    }
    return out;
  }

  function freeEntry() {
    let best = null, bestD = -1;
    for (let t = 0; t < 40; t++) {
      const r = Math.floor(rng() * rows), c = Math.floor(rng() * cols);
      if (!canHost(r, c)) continue;
      const partners = alignedPartners([r, c], 2, 4);
      if (!partners.length) continue;
      const p = partners[Math.floor(rng() * partners.length)];
      if (!openNow([r, c], p)) continue;
      const mid = [(r + p[0]) / 2, (c + p[1]) / 2];
      let d = Infinity;
      if (!mids.length) d = 1;
      else for (const [mr, mc] of mids) d = Math.min(d, Math.abs(mid[0] - mr) + Math.abs(mid[1] - mc));
      if (d > bestD) { bestD = d; best = [[r, c], p] }
    }
    if (!best) return false;
    placeEntry(best[0], best[1]);
    return true;
  }

  let fused = 0;
  let placedEntries = 0;
  for (const zone of gateDipZones) {
    if (placedEntries >= entryN) break;
    const cells = zone.map((k) => k.split(",").map(Number));
    if (tryAttachedEntry(cells, true)) { fused++; placedEntries++; }
  }
  while (placedEntries < entryN) {
    if (--guard <= 0) return die("guard-entry");
    if (!tryAttachedEntry(attachTargets(), false) && !freeEntry()) return die("entry");
    placedEntries++;
  }

  return {
    pairCells: pairs.map((p) => p.cells),
    roles: pairs.map((p) => p.role),
    gateDepths,
    lockedDepths,
    fused, // fitillenen kapı sayısı (o kapı dipleri artık dalga-0 değil)
  };
}

// Tek level üretimi. opts: { rows, cols, entryN, lockedN, gateN, depthMin,
// depthMax, cornerP, gateCornerP, dipMax, waistPosTarget, waistOpenMax,
// seed, maxAttempts }
//
// Seçim skoru (küçük iyi): dipOk/waistOk cezaları baskın; sonra bel konumu
// hedefe uzaklık (waistPosTarget verilmişse), küçük dip, yüksek cornerShare.
// Amaze GO analizi çıkarımları:
//   waistOpenMax — belde MUTLAK açık çift sayısı tavanı (endüstri pratiği
//     zorluğu oransal dip yerine "belde 2-3 açık seçenek" ile ayarlıyor).
//   waistPosTarget — bel konumu hedefi (AG belde t≈0.4-0.5; bizim üretim
//     doğal olarak erken bel veriyor, hedefle ortaya çekilebilir).
// Dönüş: { rows, cols, pairs (FIFO kanonik), roles, seed, fill, curve, flow,
//          waistOpenAbs, endOpen, ... } | null
function generateLevel(opts) {
  const rows = opts.rows, cols = opts.cols;
  const entryN = Math.max(1, opts.entryN | 0 || 3);
  const lockedN = Math.max(0, opts.lockedN | 0);
  const gateN = Math.max(1, opts.gateN | 0 || 1);
  const depthMin = Math.max(3, opts.depthMin | 0 || 3);
  const depthMax = Math.max(depthMin, opts.depthMax | 0 || depthMin + 2);
  const cornerP = opts.cornerP === undefined ? 0.7 : opts.cornerP;
  const dipMax = typeof opts.dipMax === "number" ? opts.dipMax : 0.5;
  const waistPosTarget = typeof opts.waistPosTarget === "number" ? opts.waistPosTarget : null;
  const waistOpenMax = typeof opts.waistOpenMax === "number" ? opts.waistOpenMax : null;
  const fillMin = typeof opts.fillMin === "number" ? opts.fillMin : null; // doluluk tabanı
  const maxAttempts = opts.maxAttempts || 400;
  const baseSeed = typeof opts.seed === "number" ? opts.seed >>> 0 : hashSeed(String(opts.seed));

  const scoreOf = (c) => {
    let s = 0;
    if (!c.dipOk) s += 100;
    if (!c.waistOk) s += 100;
    if (!c.fillOk) s += 100 + (fillMin - c.fill) * 200; // taban altı: açığa orantılı ceza
    if (waistPosTarget !== null) s += Math.abs(c.curve.waistPos - waistPosTarget) * 10;
    s += c.inertShare * 3; // etkisiz giriş = ölü içerik, güçlü ceza
    s += c.curve.dip;
    s -= c.curve.cornerShare * 0.5;
    return s;
  };
  const onTarget = (c) =>
    c.dipOk && c.waistOk && c.fillOk && c.curve.cornerShare >= 0.4 && c.inertShare <= 0.25 &&
    (waistPosTarget === null || Math.abs(c.curve.waistPos - waistPosTarget) <= 0.08);

  let best = null, bestScore = Infinity;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rng = mulberry32((baseSeed + Math.imul(attempt, 2654435761)) >>> 0);
    const geo = buildGeometry(rng, {
      rows, cols, entryN, lockedN, gateN, depthMin, depthMax,
      cornerP, gateCornerP: opts.gateCornerP,
    });
    if (!geo) continue;

    const curve = pairsCurve(geo.pairCells, rows, cols);
    if (!curve) continue; // tıkalı geometri
    const flow = analyzeFlow(geo.pairCells, rows, cols);
    if (flow.deadlocked.length) continue;
    // dalga-0 tasarımı: girişler + fitillenmemiş kapı dipleri
    const designedEntries = entryN + gateN - geo.fused;
    if (flow.entries !== designedEntries) continue; // kaza girişi/kaybı: yapı bozuk
    if (flow.depth < depthMin) continue;

    // belde mutlak açık çift: curve oran, alive = n - adım
    const L = curve.curve.length;
    const wIdx = Math.round(curve.waistPos * L);
    const waistOpenAbs = Math.round(curve.waist * Math.max(1, L - wIdx));
    const endSlice = curve.curve.slice(Math.floor(L * 0.8));
    const endOpen = endSlice.reduce((a, b) => a + b, 0) / Math.max(1, endSlice.length);

    // etkisiz giriş: hiçbir çiftin seçenek blokerlerinde geçmeyen dalga-0
    // çifti — kaldırılması hiçbir şey açmaz (ölü içerik)
    const boardFull = boardFromPairs(rows, cols, geo.pairCells);
    const outDeg = new Array(L).fill(0);
    for (const pc of geo.pairCells) {
      const union = new Set();
      for (const s of pairOptions(boardFull, pc)) for (const b of s) union.add(b);
      for (const b of union) outDeg[b]++;
    }
    const entryIdx = [];
    for (let i = 0; i < L; i++) if (flow.waves[i] === 0) entryIdx.push(i);
    const inertEntries = entryIdx.filter((i) => outDeg[i] === 0).length;
    const inertShare = entryIdx.length ? inertEntries / entryIdx.length : 0;

    const fill = (geo.pairCells.length * 2) / (rows * cols);
    const cand = {
      pairCells: geo.pairCells, roles: geo.roles, curve, flow,
      dipOk: curve.dip <= dipMax,
      waistOk: waistOpenMax === null || waistOpenAbs <= waistOpenMax,
      fillOk: fillMin === null || fill >= fillMin,
      waistOpenAbs, endOpen, inertEntries, inertShare,
      designedEntries, fused: geo.fused,
      fill,
      gateDepths: geo.gateDepths, lockedDepths: geo.lockedDepths,
      attempts: attempt + 1,
    };
    const s = scoreOf(cand);
    if (s < bestScore) { best = cand; bestScore = s; }
    if (onTarget(best)) break; // hedef tutturuldu
  }
  if (!best) return null;

  const pairs = best.curve.order.map((i) => best.pairCells[i]);
  const roles = best.curve.order.map((i) => best.roles[i]);
  return {
    rows, cols, pairs, roles,
    seed: baseSeed,
    entries: best.designedEntries,
    fused: best.fused,
    inertEntries: best.inertEntries,
    inertShare: best.inertShare,
    fill: best.fill,
    dipOk: best.dipOk,
    waistOk: best.waistOk,
    fillOk: best.fillOk,
    waistOpenAbs: best.waistOpenAbs,
    endOpen: best.endOpen,
    curve: best.curve,
    flow: best.flow,
    gateDepths: best.gateDepths,
    lockedDepths: best.lockedDepths,
    attempts: best.attempts,
  };
}

// N aday üretir (türetilmiş seedlerle, deterministik).
function generateCandidates(opts) {
  const baseSeed = typeof opts.seed === "number" ? opts.seed >>> 0 : hashSeed(String(opts.seed));
  const n = opts.samples || 12;
  const out = [];
  let failed = 0;
  for (let i = 0; i < n; i++) {
    const res = generateLevel({ ...opts, seed: (baseSeed + Math.imul(i + 1, 40503)) >>> 0 });
    if (res) out.push(res);
    else failed++;
  }
  return { candidates: out, failed, baseSeed };
}

if (typeof module !== "undefined") {
  module.exports = {
    mulberry32, hashSeed, shuffle,
    buildGeometry, generateLevel, generateCandidates,
  };
}
