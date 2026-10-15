"use strict";

// v3 kütüphanesi — Tile Generator'lı level inşası ve ölçümü.
// Kullanan: tools/gen_v3_levels.js (üretim) ve ölçüm betikleri.
//
// İnşa fikri: önce tam dolu bir "saf" level (js/generator.js
// generateFullLevel) üretilir; sonra bir KALIP (spec) uygulanır:
//   1. generator hücreleri + yönleri seçilir (yerleşim ailesi: kenar /
//      köşe / iç / karşılıklı). Generator hücresindeki taş zorunlu olarak
//      kuyruğa iner.
//   2. kuyruklar doldurulur: boarddan taşlar ÇEKİLİR (kalkan taşın çifti
//      kuyruğa yazılır, eşi boardda kalır). Seçim stratejisi eşin generator
//      ÖNÜNE uzaklığına bakar: "near" → basıldığında eşi yakın (akış),
//      "far" → eşi uzak/gömülü (düğüm), "alt" → sırayla (ritim),
//      "random". Sürpriz mekaniği (oyuncu yalnız sayaç görür): tempo bizde,
//      planlama oyuncuda değil.
//   3. boşalan hücreler yeniden doldurulur: "none" (seyrek board, uzun
//      kuyruk), "pairs" (yeni tam çiftler → çift sayısı alanı aşar),
//      "singles" (yeni tek taşlar, eşleri kuyruklara → daha derin kuyruk).
//   4. isteğe bağlı SENKRON: bir çiftin iki taşı iki ayrı kuyruğun aynı
//      indeksine → aynı anda basılır, board boyunca eşleşir.
//   5. doğrulama: js/board.js generatorIssues (yerleşim) + efor
//      simülasyonu (effortCurve null = tıkalı). Monotonluk sayesinde tek
//      greedy koşu çözülebilirliği kanıtlar.
// Yapısal yasaklar burada erken elenir: generator önündeki taşın eşi aynı
// generator'ın kuyruğunda olamaz (ön hiç açılmaz → kilit); kuyrukta aynı
// çiftin iki taşı olamaz.

const { generateFullLevel } = require("../js/generator.js");
const { isAdjacentCollinear, GEN_DIRS, generatorIssues, boardFromPairs, cloneGenerators,
        applyGenerators, visibleTilesFrom } = require("../js/board.js");
const { effortCurve, spanOf, isCollinear } = require("../js/flow.js");

function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
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
const manh = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

// ── generator yerleşimi ──
// Dönüş: [{ r, c, dir }] ya da null (yer bulunamadı). Ön hücreler ayrık,
// generator hücreleri birbirinin önü değil.
// occupied: Set(hücre anahtarı) — generator ve ön hücre dolu olmalı.
// score(r, c, dir): yüksek = tercih (isteğe bağlı; gürültüyle sıralanır).
function placeGenerators(rows, cols, placement, genN, rng, occupied, score) {
  const gens = [];
  const taken = new Set(); // generator ve ön hücreler
  const K = (r, c) => r * cols + c;
  const front = (r, c, dir) => [r + GEN_DIRS[dir][0], c + GEN_DIRS[dir][1]];
  const inBoard = (r, c) => r >= 0 && r < rows && c >= 0 && c < cols;
  const tryAdd = (r, c, dir) => {
    const [fr, fc] = front(r, c, dir);
    if (!inBoard(fr, fc) || taken.has(K(r, c)) || taken.has(K(fr, fc))) return false;
    if (occupied && (!occupied.has(K(r, c)) || !occupied.has(K(fr, fc)))) return false;
    gens.push({ r, c, dir });
    taken.add(K(r, c)); taken.add(K(fr, fc));
    return true;
  };
  const edgeCells = () => {
    const out = [];
    for (let c = 1; c < cols - 1; c++) { out.push([0, c, "D"]); out.push([rows - 1, c, "U"]); }
    for (let r = 1; r < rows - 1; r++) { out.push([r, 0, "R"]); out.push([r, cols - 1, "L"]); }
    return out;
  };
  const cornerCells = () => [
    [0, 0, "R"], [0, 0, "D"], [0, cols - 1, "L"], [0, cols - 1, "D"],
    [rows - 1, 0, "R"], [rows - 1, 0, "U"], [rows - 1, cols - 1, "L"], [rows - 1, cols - 1, "U"],
  ];
  const innerCells = () => {
    const out = [];
    for (let r = 1; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++) {
      for (const d of ["U", "D", "L", "R"]) out.push([r, c, d]);
    }
    return out;
  };
  let pool;
  if (placement === "facing") {
    // aynı satır ya da sütunda birbirine bakan iki generator; kalan
    // generator'lar kenardan
    const horiz = rng() < 0.5;
    if (horiz) {
      const r = 1 + Math.floor(rng() * (rows - 2));
      const a = Math.floor(rng() * 2), b = cols - 1 - Math.floor(rng() * 2);
      if (b - a < 4) return null;
      tryAdd(r, a, "R"); tryAdd(r, b, "L");
    } else {
      const c = 1 + Math.floor(rng() * (cols - 2));
      const a = Math.floor(rng() * 2), b = rows - 1 - Math.floor(rng() * 2);
      if (b - a < 4) return null;
      tryAdd(a, c, "D"); tryAdd(b, c, "U");
    }
    pool = shuffle(edgeCells(), rng);
  } else if (placement === "corner") {
    pool = shuffle(cornerCells(), rng).concat(shuffle(edgeCells(), rng));
  } else if (placement === "inner") {
    pool = shuffle(innerCells(), rng);
  } else if (placement === "mixed") {
    pool = shuffle(edgeCells().concat(innerCells()), rng);
  } else { // edge
    pool = shuffle(edgeCells(), rng);
  }
  if (score) {
    // puan + gürültü ile sırala (corner ailesinde köşe önceliği korunur:
    // köşe adayları ilk 8 eleman — onları kendi içinde sırala)
    const rankBy = (arr) => arr.map((x) => [x, score(x[0], x[1], x[2]) + rng() * 0.3])
      .sort((a, b) => b[1] - a[1]).map((x) => x[0]);
    if (placement === "corner") pool = rankBy(pool.slice(0, 8)).concat(rankBy(pool.slice(8)));
    else pool = rankBy(pool);
  }
  for (const [r, c, d] of pool) {
    if (gens.length >= genN) break;
    tryAdd(r, c, d);
  }
  return gens.length === genN ? gens : null;
}

// ── kalıp uygulama: simüle-et-ve-çek ──
// base: { pairs } tam dolu saf level (iki koordinatlı çiftler)
// spec: { placement, genN, queueLen, pick, refill, refillFrac, syncN,
//         queueMax, spawnBias }
//
// Kuyruk sırayla basılır: k. taş, (k-1). taş eşleşip ön boşalınca gelir.
// Rastgele çekim bu zinciri kırar (kuyruktaki taşın eşi, önceki kuyruk
// taşının eşine bağımlı olabilir → kilit). Bunun yerine her kuyruk taşı
// SİMÜLASYON ZAMANINDA seçilir: mevcut level simüle edilir, generator'ın
// kuyruğunun bittiği an t bulunur, o anda iki taşı da boardda olan bir
// çiftten bir taş çekilir. Çekim başlangıç boardunu boşaltır (monoton:
// önceki adımlar bozulmaz); çekilen taş t anında öne basılır ve eşi o
// anda boardda → er geç eşleşir. Yine de her adım simülasyonla doğrulanır
// (çapraz generator kilitleri için).
// Doldurma ("singles"/"pairs") başlangıç boarduna taş EKLER (monoton
// değil) → yalnız doğrulamalı.
// Dönüş: { pairs, generators } ya da null.
function applySpec(base, rows, cols, spec, rng) {
  const K = (r, c) => r * cols + c;
  const RC = (k) => [Math.floor(k / cols), k % cols];
  const pairs = base.pairs.map((p) => p.map((t) => t.slice()));
  const cellOf = new Map(); // başlangıç boardu: hücre → pid
  pairs.forEach((p, pid) => p.forEach((t) => cellOf.set(K(t[0], t[1]), pid)));
  const occupied = new Set(cellOf.keys());
  const frontOf = (g) => [g.r + GEN_DIRS[g.dir][0], g.c + GEN_DIRS[g.dir][1]];
  const sim = (gens) => effortCurve(pairs, rows, cols, null, "sweep", gens);

  const snapshot = (gens) => ({
    pairs: pairs.map((p) => p.map((t) => t.slice())),
    cellOf: new Map(cellOf), queues: gens.map((g) => g.queue.slice()),
  });
  const restore = (s, gens) => {
    pairs.length = 0; for (const p of s.pairs) pairs.push(p);
    cellOf.clear(); for (const [k, v] of s.cellOf) cellOf.set(k, v);
    gens.forEach((g, i) => { g.queue = s.queues[i]; });
  };
  // Kuyruğa ekleme konumu: generator'ın kendi taşı (anchor) kuyruğun SONU
  // olarak kalır — eşi genelde derin, zinciri geç açar; yeni taşlar onun
  // önüne girer (anchor son sırada değilse sona eklenir).
  const anchorOf = new Map(); // gi → kendi taşının pid'i
  const insertPos = (gens, gi) => {
    const q = gens[gi].queue;
    const a = anchorOf.get(gi);
    return q.length && a !== undefined && q[q.length - 1] === a ? q.length - 1 : q.length;
  };
  const pullCell = (k, gens, gi, pos) => {
    const pid = cellOf.get(k);
    const [r, c] = RC(k);
    const p = pairs[pid];
    p.splice(p.findIndex((t) => t[0] === r && t[1] === c), 1);
    cellOf.delete(k);
    gens[gi].queue.splice(pos === undefined ? gens[gi].queue.length : pos, 0, pid);
  };

  // saf çözüm sırası: generator hücresinin taşı GEÇ, önündeki taş ERKEN
  // eşleşiyorsa yerleşim kilitlenmez (ölçüm: Y geç+F erken %74-86, Y erken
  // %31-40). Y çok geç olursa kuyruk geç açılır → orta-geç tatlı nokta.
  const pureEc = effortCurve(pairs, rows, cols, null, "sweep");
  if (!pureEc) return null;
  const rank = new Array(pairs.length).fill(0.5);
  pureEc.order.forEach((pid, i) => { rank[pid] = i / pureEc.order.length; });
  const placeScore = (r, c, dir) => {
    const y = cellOf.get(K(r, c));
    const f = cellOf.get(K(r + GEN_DIRS[dir][0], c + GEN_DIRS[dir][1]));
    if (y === undefined || f === undefined) return -9;
    const ry = rank[y], rf = rank[f];
    return (ry < 0.4 ? ry : ry < 0.8 ? 0.4 + (ry - 0.4) * 0.5 : 0.6 - (ry - 0.8)) - rf;
  };

  // 1) yerleşim: dolu boarda; generator hücresinin taşı (Y) kuyruğa iner.
  //    Kırılgan adım (Y'nin hücresi kuyruk bitene dek duvar) → Y geç + ön
  //    taş erken puanıyla seçilir, simülasyonla doğrulanır. (Maskeli taban
  //    denendi ve geçersiz: generator.js'de maske deliği duvar değil tap
  //    edilebilir boşluktur.)
  let gens = null;
  for (let t = 0; t < 10 && !gens; t++) {
    const pl = placeGenerators(rows, cols, spec.placement, spec.genN, rng, occupied, placeScore);
    if (!pl) { if (process.env.V3_DEBUG) console.error("place none", spec.placement, spec.genN); return null; }
    const cand = pl.map((g) => ({ r: g.r, c: g.c, dir: g.dir, queue: [] }));
    const fp = cand.map((g) => { const [fr, fc] = frontOf(g); return cellOf.get(K(fr, fc)); });
    const snap = snapshot(cand);
    let ok = true;
    for (let gi = 0; gi < cand.length && ok; gi++) {
      const k = K(cand[gi].r, cand[gi].c);
      const pid = cellOf.get(k);
      let target = gi;
      if (pid === fp[gi]) { // kendi önüyle çift → kilit; başka kuyruğa
        target = cand.findIndex((_, oj) => oj !== gi && fp[oj] !== pid);
        if (target < 0) ok = false;
      }
      if (ok) { pullCell(k, cand, target); if (target === gi) anchorOf.set(gi, pid); }
    }
    if (ok && sim(cand)) gens = cand;
    else { restore(snap, cand); anchorOf.clear(); if (process.env.V3_DEBUG) console.error("place fail", ok ? "dead" : "selfpair", spec.placement, spec.genN); }
  }
  if (!gens) return null;
  const genCells = new Set(gens.map((g) => K(g.r, g.c)));
  // başlangıç ön hücreleri (tıpa) çekilemez
  gens.forEach((g) => { const [fr, fc] = frontOf(g); genCells.add(K(fr, fc)); });
  // board köşeleri çekilemez: açılışta tek başına boş köşe (tasarımcı
  // istemiyor — boşluk ortada kalsın)
  const isCorner = (t) => (t[0] === 0 || t[0] === rows - 1) && (t[1] === 0 || t[1] === cols - 1);

  // generator gi'ye eklenecek taşın BASILACAĞI an: ekleme konumundan önceki
  // kuyruk taşının eşleştiği hamle (kuyruk başıysa tıpanın eşleşmesi); o
  // andan sonra hayatta olan çiftler
  const breakInfo = (ec, gi) => {
    const q = gens[gi].queue;
    const [fr, fc] = frontOf(gens[gi]);
    const pos = insertPos(gens, gi);
    const prev = pos > 0 ? q[pos - 1] : cellOf.get(K(fr, fc));
    const tBreak = ec.order.indexOf(prev);
    const gone = new Set(ec.order.slice(0, tBreak + 1));
    return { tBreak, gone, pos };
  };

  // Simülasyonun t. hamlesinden SONRAKİ board durumu (yeniden oynatma).
  // Basılan taşların son konumu ec.pairs'te; eşleşme anında oradadır.
  const stateAt = (ec, upto) => {
    const live = pairs.map((p) => p.map((t) => t.slice()));
    const board = boardFromPairs(rows, cols, live);
    const gc = cloneGenerators(gens);
    gc.forEach((g, gi) => { board[g.r][g.c] = -1 - gi; });
    for (let t = 0; t <= upto && t < ec.moves.length; t++) {
      for (const pid of ec.moves[t].pairIds) for (const [r, c] of ec.pairs[pid]) board[r][c] = null;
      applyGenerators(board, gc);
    }
    return board;
  };
  // F hücresine basılacak taşla HEMEN eşleşebilecek board taşları: F ile
  // hizalı, arası boş bir boş hücre e var ve e'den görünen taş. (Eşleşme =
  // iki taşı da gören boş hücreye tap.) Dönüş Map pid → [r, c] (kalacak eş).
  const matchableFromFront = (board, g) => {
    const F = frontOf(g);
    const out = new Map();
    board[g.r][g.c] = -1; // generator yerinde (kuyruk sürerken duvar)
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      let r = F[0] + dr, c = F[1] + dc;
      while (r >= 0 && r < rows && c >= 0 && c < cols && board[r][c] === null) {
        for (const t of visibleTilesFrom(board, r, c)) {
          if (t.pairId >= 0 && !out.has(t.pairId)) out.set(t.pairId, [t.r, t.c]);
        }
        r += dr; c += dc;
      }
    }
    return out;
  };
  // gecikme (k): basılan taş kaç hamle sonra eşleşebilir hale gelsin
  const delayOf = (g) => {
    const L = spec.pick;
    if (L === "near") return 0;
    if (L === "mid") return 3;
    if (L === "far") return 7;
    if (L === "alt") return g.queue.length % 2 === 0 ? 0 : 5;
    return Math.floor(rng() * 7); // random
  };

  // bir kuyruğa bir taş ekle (çekim). Dönüş true/false.
  const addPull = (gi, ec) => {
    const g = gens[gi];
    const { tBreak, gone, pos } = breakInfo(ec, gi);
    const k = delayOf(g);
    const tState = Math.min(ec.moves.length - 1, tBreak + k);
    const board = stateAt(ec, tState);
    const vis = matchableFromFront(board, g);
    // adaylar: tState'te öne basılsa hemen eşleşir; iki taşı da başlangıçta
    // boardda; generator/ön hücresi değil; k>0 ise tBreak anında görünmesin
    // (gerçekten "gecikmeli" olsun)
    let vis0 = null;
    if (k > 0) vis0 = matchableFromFront(stateAt(ec, tBreak), g);
    let cand = [];
    for (const [pid, mate] of vis) {
      const p = pairs[pid];
      if (gone.has(pid) || p.length !== 2) continue;
      if (p.some((t) => genCells.has(K(t[0], t[1])))) continue;
      if (vis0 && vis0.has(pid)) continue;
      const pullIdx = p.findIndex((t) => !(t[0] === mate[0] && t[1] === mate[1]));
      if (pullIdx < 0 || isCorner(p[pullIdx])) continue;
      cand.push({ pid, pullIdx });
    }
    if (!cand.length && vis0) { // gecikmeli aday yok → hemen eşleşenlerden
      for (const [pid, mate] of vis) {
        const p = pairs[pid];
        if (gone.has(pid) || p.length !== 2) continue;
        if (p.some((t) => genCells.has(K(t[0], t[1])))) continue;
        const pullIdx = p.findIndex((t) => !(t[0] === mate[0] && t[1] === mate[1]));
        if (pullIdx >= 0 && !isCorner(p[pullIdx])) cand.push({ pid, pullIdx });
      }
    }
    if (!cand.length) { if (process.env.V3_DEBUG) console.error("pull nocand gi", gi, "tBreak", tBreak, "/", ec.order.length); return false; }
    cand = shuffle(cand, rng);
    for (const c of cand.slice(0, 6)) {
      const snap = snapshot(gens);
      const t = pairs[c.pid][c.pullIdx];
      pullCell(K(t[0], t[1]), gens, gi, pos);
      if (sim(gens)) return true;
      restore(snap, gens);
    }
    if (process.env.V3_DEBUG) console.error("pull fail gi", gi, "cand", cand.length, "tBreak", tBreak, "/", ec.order.length);
    return false;
  };

  // doldurma-tek: başlangıçta boş bir hücreye yeni taş Z, eşi kuyruğa.
  // Z, basım anında F'den eşleşebilir bir hücrede olsun (boş hücre e, F ile
  // hizalı ve Z'yi gören). Başlangıç boarduna taş eklemek monoton değil →
  // doğrulama.
  const addSingle = (gi, ec) => {
    const g = gens[gi];
    const F = frontOf(g);
    const { tBreak, pos } = breakInfo(ec, gi);
    const k = delayOf(g);
    const board = stateAt(ec, Math.min(ec.moves.length - 1, tBreak + k));
    board[g.r][g.c] = -1;
    // F ile hizalı boş hücreler e; e'nin gördüğü yönlerdeki İLK boş hücre
    // adayı… sadeleştirme: e'den 4 yöne giden ışında ilk taşa kadar olan boş
    // hücreler Z için aday (Z oraya konunca e Z'yi görür)
    const candSet = new Set();
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      let r = F[0] + dr, c = F[1] + dc;
      while (r >= 0 && r < rows && c >= 0 && c < cols && board[r][c] === null) {
        for (const [er, ecc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          if (er === -dr && ecc === -dc) continue; // F'ye geri bakan yön
          let rr = r + er, cc = c + ecc;
          while (rr >= 0 && rr < rows && cc >= 0 && cc < cols && board[rr][cc] === null) {
            const kk = K(rr, cc);
            if (!cellOf.has(kk) && !genCells.has(kk)) candSet.add(kk); // başlangıçta da boş
            rr += er; cc += ecc;
          }
        }
        r += dr; c += dc;
      }
    }
    const cand = shuffle([...candSet], rng);
    if (!cand.length) return false;
    for (const kk of cand.slice(0, 5)) {
      const snap = snapshot(gens);
      const pid = pairs.length;
      pairs.push([RC(kk)]);
      cellOf.set(kk, pid);
      g.queue.splice(pos, 0, pid);
      if (sim(gens)) return true;
      restore(snap, gens);
    }
    return false;
  };

  // 2) kuyruklar: tur tur (eşit derinlik). refill=singles ise turların bir
  //    kısmı doldurma (başlangıç boardu seyrelmesin, kuyruk derinleşsin)
  const singleEvery = spec.refill === "singles" ? (spec.refillFrac >= 0.75 ? 2 : 3) : 0;
  const stuck = new Array(gens.length).fill(0);
  for (let round = 0; round < spec.queueLen; round++) {
    for (let gi = 0; gi < gens.length; gi++) {
      if (gens[gi].queue.length >= spec.queueLen || stuck[gi] >= 3) continue;
      const ec = sim(gens);
      if (!ec) return null;
      const doSingle = singleEvery && round > 0 && round % singleEvery === 0;
      const ok = doSingle ? (addSingle(gi, ec) || addPull(gi, ec)) : addPull(gi, ec);
      if (!ok) stuck[gi]++; else stuck[gi] = 0;
    }
  }
  // kuyruk tavanı ötesi doldurma (singles, queueMax'a kadar)
  if (spec.refill === "singles" && spec.queueMax > spec.queueLen) {
    for (let round = spec.queueLen; round < spec.queueMax; round++) {
      let any = false;
      for (let gi = 0; gi < gens.length; gi++) {
        if (gens[gi].queue.length >= spec.queueMax) continue;
        const ec = sim(gens);
        if (!ec) return null;
        if (addSingle(gi, ec)) any = true;
      }
      if (!any) break;
    }
  }

  // 3) senkron: iki kuyruğa aynı anda (tur sonu) bir çiftin iki taşı
  if (spec.syncN && gens.length >= 2) {
    for (let s = 0; s < spec.syncN; s++) {
      const ec = sim(gens);
      if (!ec) return null;
      const ga = Math.floor(rng() * gens.length);
      let gb = Math.floor(rng() * (gens.length - 1)); if (gb >= ga) gb++;
      const A = breakInfo(ec, ga), B = breakInfo(ec, gb);
      const gone = A.tBreak > B.tBreak ? A.gone : B.gone;
      const pool = [];
      pairs.forEach((p, pid) => {
        if (gone.has(pid) || p.length !== 2) return;
        if (p.some((t) => genCells.has(K(t[0], t[1])) || isCorner(t))) return;
        pool.push(pid);
      });
      if (!pool.length) break;
      const pid = pool[Math.floor(rng() * pool.length)];
      const snap = snapshot(gens);
      const ks = pairs[pid].map((t) => K(t[0], t[1]));
      pullCell(ks[0], gens, ga, A.pos);
      pullCell(ks[1], gens, gb, insertPos(gens, gb));
      if (!sim(gens)) restore(snap, gens);
    }
  }

  // 4) doldurma-çift: başlangıçta boş hücreleri ikişer eşle (doğrulamalı)
  if (spec.refill === "pairs") {
    const frac = typeof spec.refillFrac === "number" ? spec.refillFrac : 1;
    let empties = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const k = K(r, c);
      if (!cellOf.has(k) && !genCells.has(k)) empties.push(k);
    }
    empties = shuffle(empties, rng).slice(0, Math.floor(empties.length * frac));
    let failures = 0;
    while (empties.length >= 2 && failures < 6) {
      const a = empties.shift();
      const A = RC(a);
      let bi = -1, bd = Infinity;
      empties.forEach((k, i) => {
        const B = RC(k);
        if (isAdjacentCollinear([A, B])) return;
        const d = manh(A, B) - (A[0] === B[0] || A[1] === B[1] ? 2 : 0) + rng() * 2;
        if (d < bd) { bd = d; bi = i; }
      });
      if (bi < 0) { failures++; continue; }
      const b = empties.splice(bi, 1)[0];
      const snap = snapshot(gens);
      const pid = pairs.length;
      pairs.push([A, RC(b)]);
      cellOf.set(a, pid); cellOf.set(b, pid);
      if (!sim(gens)) { restore(snap, gens); pairs.length = snap.pairs.length; failures++; empties.push(b); }
    }
  }

  if (gens.some((g) => g.queue.length === 0)) return null;
  return { pairs, generators: gens };
}

// Ölçüm: tasarımcı sn (sweep yükü/10), öğütme payı (basılmış konumlarla),
// generator meta. null = tıkalı.
function measureLevel(lv, rows, cols) {
  const ecS = effortCurve(lv.pairs, rows, cols, null, "sweep", lv.generators);
  if (!ecS) return null;
  const n = lv.pairs.length;
  const sec = ecS.effortMean * n / 10;
  const LONG = Math.ceil(0.5 * Math.max(rows, cols));
  const L = ecS.moves.length;
  const isLong = ecS.moves.map((m) => m.pairIds.every((pid) => spanOf(ecS.pairs[pid]) >= LONG));
  let g = 0;
  for (let t = 0; t < L; t++) {
    if (isLong[t] && ((t > 0 && isLong[t - 1]) || (t + 1 < L && isLong[t + 1]))) g++;
  }
  let coll = 0;
  for (const p of ecS.pairs) if (isCollinear(p)) coll++;
  return { sec, grind: g / L, ecS, collShare: coll / n, pairsN: n,
           queued: (lv.generators || []).reduce((a, x) => a + x.queue.length, 0) };
}

// Saf taban level (mask isteğe bağlı: mask[r][c] false = dışarıda)
function basePure(rows, cols, rec, seed, mask) {
  return generateFullLevel({
    rows, cols, mask: mask || null, seed,
    entryN: rec.entryN, frontMode: rec.frontMode, frontBias: rec.frontBias,
    cornerP: rec.cornerP, spanBias: rec.spanBias, knots: rec.knots, cut: rec.cut,
  });
}

// Tam inşa: generator yerleşimi → generator hücreleri maskeli saf taban →
// kalıp (kuyruklar) → yapısal doğrulama. null = başarısız.
// spec.mode "pull" (varsayılan: maskeli) | "dense" (dolu boarda yerleşim).
// mask (isteğe bağlı): saf tabanın açılış boşlukları (mask[r][c] false =
// boş hücre). Verilmezse generator.js'nin onarımı (merkez + sağ alt köşe).
function buildLevel(rows, cols, rec, spec, seed, mask) {
  if (!spec) {
    const base = basePure(rows, cols, rec, seed, mask);
    return base ? { pairs: base.pairs, generators: null, maskArea: base.maskArea } : null;
  }
  // Not: generator.js'de maske deliği DUVAR değil tap edilebilir boşluktur;
  // generator hücresi duvar gibi davrandığından maskeli taban geçersiz →
  // dolu taban + puanlı yerleşim + doğrulama.
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  for (let t = 0; t < 3; t++) {
    const base = basePure(rows, cols, rec, seed + t * 7919, mask);
    if (!base) continue;
    const lv = applySpec(base, rows, cols, spec, rng);
    if (!lv) continue;
    const issues = generatorIssues({ rows, cols, pairs: lv.pairs, generators: lv.generators });
    if (issues.length) { if (process.env.V3_DEBUG) console.error("issues", issues[0]); continue; }
    return { pairs: lv.pairs, generators: lv.generators, maskArea: base.maskArea };
  }
  return null;
}

module.exports = { hashSeed, mulberry32, shuffle, placeGenerators, applySpec,
                   measureLevel, basePure, buildLevel };
