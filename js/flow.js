"use strict";

// Katman 1 — ölçüm: bağımlılık analizi (analyzeFlow) + adım eğrisi (pairsCurve).
//
// Tap match'te bir çiftin açılması AND/OR yapısındadır:
//   hizalı çift  → TEK seçenek: koridordaki taşların sahipleri (HEPSİ kalkmalı)
//   hizasız çift → İKİ seçenek (köşe başına): köşe hücresini dolduran taş +
//                  iki bacakta araya giren taşlar (o seçeneğin HEPSİ kalkmalı;
//                  seçeneklerden BİRİ yeterli)
// Bu yüzden dalga sayısı düz topolojik katman değil, AND/OR fixpoint'iyle
// hesaplanır: dalga(P) = min_seçenek( boşsa 0, değilse 1 + max_bloker dalga ).
// dalga = ∞ kalan çift YAPISAL DEADLOCK'tur (span-1 hizalı çift ya da
// karşılıklı köşe kilidi gibi döngüler). Monotonluk sayesinde dalga sayıları
// sıradan bağımsızdır: taş kalkması seçenekleri yalnız açar.

// Node için board yardımcıları; tarayıcıda script etiketiyle global.
if (typeof module !== "undefined" && typeof boardFromPairs === "undefined") {
  var { boardFromPairs, visibleTilesFrom, availableTapCells, resolveTap, applyMatches } =
    require("./board.js");
}

function spanOf([[r1, c1], [r2, c2]]) {
  return Math.abs(r1 - r2) + Math.abs(c1 - c2);
}

function isCollinear([[r1, c1], [r2, c2]]) {
  return r1 === r2 || c1 === c2;
}

// Çift i'nin açılma seçenekleri (tam dolu başlangıç boardında).
// Dönüş: Set(pairId) listesi — her set bir seçeneğin blokerleri.
// Boş liste = hiç seçenek yok (span-1 hizalı çift, doğuştan ölü).
function pairOptions(board, pair) {
  const [[r1, c1], [r2, c2]] = pair;
  const opts = [];
  if (r1 === r2 || c1 === c2) {
    if (spanOf(pair) < 2) return [];
    const s = new Set();
    if (r1 === r2) {
      for (let c = Math.min(c1, c2) + 1; c < Math.max(c1, c2); c++) {
        if (board[r1][c] !== null) s.add(board[r1][c]);
      }
    } else {
      for (let r = Math.min(r1, r2) + 1; r < Math.max(r1, r2); r++) {
        if (board[r][c1] !== null) s.add(board[r][c1]);
      }
    }
    opts.push(s);
    return opts;
  }
  // Hizasız: köşe başına bir seçenek. Köşe (kr,kc); bacaklar köşeden iki taşa.
  for (const [kr, kc] of [[r1, c2], [r2, c1]]) {
    const s = new Set();
    if (board[kr][kc] !== null) s.add(board[kr][kc]);
    for (const [tr, tc] of [[r1, c1], [r2, c2]]) {
      if (tr === kr) {
        for (let c = Math.min(tc, kc) + 1; c < Math.max(tc, kc); c++) {
          if (board[tr][c] !== null) s.add(board[tr][c]);
        }
      } else {
        for (let r = Math.min(tr, kr) + 1; r < Math.max(tr, kr); r++) {
          if (board[r][tc] !== null) s.add(board[r][tc]);
        }
      }
    }
    opts.push(s);
  }
  return opts;
}

// Bağımlılık analizi. Dönüş null = boş level; deadlocked alanı boş değilse
// level yapısal olarak bitmez.
function analyzeFlow(pairs, rows, cols) {
  const n = pairs.length;
  if (n === 0) return null;
  const board = boardFromPairs(rows, cols, pairs);
  const options = pairs.map((p) => pairOptions(board, p));

  // AND/OR dalga fixpoint'i
  const INF = Infinity;
  const wave = new Array(n).fill(INF);
  for (let round = 0; round < n + 1; round++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let best = INF;
      for (const opt of options[i]) {
        let w = 0;
        for (const q of opt) {
          if (wave[q] === INF) { w = INF; break; }
          w = Math.max(w, wave[q] + 1);
        }
        if (w < best) best = w;
      }
      if (best < wave[i]) { wave[i] = best; changed = true; }
    }
    if (!changed) break;
  }
  const deadlocked = [];
  for (let i = 0; i < n; i++) if (wave[i] === INF) deadlocked.push(i);

  // Sıkı kilit-açma grafı: her çift için dalgasını gerçekleyen (min) seçeneğin
  // blokerleri = dolaysız öngereksinimler. Deadlock'suz durumda dalga sırasına
  // göre DAG'dır (blokerlerin dalgası hep küçük).
  const pred = Array.from({ length: n }, () => new Set());
  if (deadlocked.length === 0) {
    for (let i = 0; i < n; i++) {
      if (wave[i] === 0) continue;
      let bestOpt = null, bestW = INF;
      for (const opt of options[i]) {
        let w = 0;
        for (const q of opt) w = Math.max(w, wave[q] + 1);
        if (opt.size && w < bestW) { bestW = w; bestOpt = opt; }
      }
      if (bestOpt) for (const q of bestOpt) pred[i].add(q);
    }
  }
  const succ = Array.from({ length: n }, () => new Set());
  for (let b = 0; b < n; b++) for (const a of pred[b]) succ[a].add(b);

  // Transitive reduction (ttm flow.js portu) — topo sıra: dalgaya göre.
  const topo = Array.from({ length: n }, (_, i) => i)
    .filter((i) => wave[i] !== INF)
    .sort((a, b) => wave[a] - wave[b]);
  const reach = Array.from({ length: n }, () => new Set());
  for (let idx = topo.length - 1; idx >= 0; idx--) {
    const a = topo[idx];
    for (const b of succ[a]) {
      reach[a].add(b);
      for (const x of reach[b]) reach[a].add(x);
    }
  }
  const rpred = Array.from({ length: n }, () => new Set());
  for (let b = 0; b < n; b++) {
    for (const a of pred[b]) {
      let redundant = false;
      for (const c of succ[a]) {
        if (c !== b && reach[c].has(b)) { redundant = true; break; }
      }
      if (!redundant) rpred[b].add(a);
    }
  }
  const rsucc = Array.from({ length: n }, () => new Set());
  for (let b = 0; b < n; b++) for (const a of rpred[b]) rsucc[a].add(b);

  let entries = 0, chain = 0, knots = 0, terminals = 0;
  for (let i = 0; i < n; i++) {
    const rin = rpred[i].size, rout = rsucc[i].size;
    if (rin === 0) entries++;
    if (rin === 1 && rout === 1) chain++;
    if (rin >= 2 || rout >= 2) knots++;
    if (rout === 0) terminals++;
  }

  // Dalga genişlikleri (deadlock yoksa depth = max dalga + 1)
  const depth = deadlocked.length ? 0 : Math.max(...wave) + 1;
  const waveWidths = [];
  if (depth) {
    for (let w = 0; w < depth; w++) waveWidths.push(wave.filter((x) => x === w).length);
  }

  // Bütünlük: sıkı grafın zayıf bağlı bileşenleri
  const comp = new Array(n).fill(-1);
  let comps = 0;
  for (let s = 0; s < n; s++) {
    if (comp[s] !== -1) continue;
    const stack = [s];
    comp[s] = comps;
    while (stack.length) {
      const a = stack.pop();
      for (const b of pred[a]) if (comp[b] === -1) { comp[b] = comps; stack.push(b); }
      for (const b of succ[a]) if (comp[b] === -1) { comp[b] = comps; stack.push(b); }
    }
    comps++;
  }
  const compSizes = new Array(comps).fill(0);
  for (const c of comp) compSizes[c]++;
  const reducedEdges = rpred.reduce((a, s) => a + s.size, 0);

  return {
    pairs: n,
    deadlocked,
    waves: wave,
    entries, chain, knots, terminals,
    entryRatio: entries / n,
    chainRatio: chain / n,
    nodeRatio: knots / n,
    depth,
    depthNorm: depth / n,
    waveWidths,
    meanWaveWidth: depth ? n / depth : 0,
    maxWaveWidth: depth ? Math.max(...waveWidths) : 0,
    branching: reducedEdges / n,
    comps,
    maxCompShare: Math.max(...compSizes) / n,
    singletons: compSizes.filter((s) => s === 1).length,
  };
}

// Board tek geçişte taranır: match veren hücreler (çift bazında), gürültü
// (≥2 taş gören ama çift vermeyen hücre — oyuncuya "belki buradan" dedirten
// yem) ve boş hücre sayısı.
function scanBoard(board) {
  const rows = board.length, cols = board[0].length;
  const openOf = new Map(); // pairId → [hücre,...]
  let matchCells = 0, missCells = 0, emptyCells = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (board[r][c] !== null) continue;
      emptyCells++;
      const seen = visibleTilesFrom(board, r, c);
      if (seen.length < 2) continue;
      const cnt = new Map();
      let matched = false;
      for (const t of seen) cnt.set(t.pairId, (cnt.get(t.pairId) || 0) + 1);
      for (const [pid, k] of cnt) {
        if (k === 2) {
          matched = true;
          if (!openOf.has(pid)) openOf.set(pid, []);
          openOf.get(pid).push([r, c]);
        }
      }
      if (matched) matchCells++;
      else missCells++;
    }
  }
  return { openOf, matchCells, missCells, emptyCells };
}

// FIFO oyuncu modeliyle adım eğrisi (ttm pairsCurve portu + arama eforu).
// Kısmi doluluk yüzünden rows/cols gerekir. Dönüş null = tıkalı eşleme.
//
// Yapısal eğri: curve[t] = açık çift / kalan çift (ttm ile aynı; U'nun iskeleti).
// Arama eforu:  effort[t] = boş hücre / match veren hücre — oyuncunun doğru
// hücreyi bulmak için taraması gereken alanın kaba modeli. Belde yüksek effort
// = senin "düğüm"ün; girişte/sonda düşük effort = U'nun kolları.
// pickKind[t]: oynanan çiftin türü (koridor = hizalı, kolay görülür;
// köşe = hizasız, iki cross'un kesişimini ister — bilişsel yük).
function pairsCurve(pairs, rows, cols) {
  const n = pairs.length;
  if (n === 0) return null;
  const board = boardFromPairs(rows, cols, pairs);
  const alive = new Set(pairs.map((_, i) => i));
  const stampOf = new Map(); // çift → ilk açıldığı adım (FIFO anahtarı)
  const curve = [], effort = [], noise = [], openCellsArr = [], pickKind = [], pickSpan = [];
  const order = [];
  let step = 0;
  while (alive.size) {
    const scan = scanBoard(board);
    let open = 0, pick = -1, pickKey = Infinity;
    for (const i of alive) {
      if (!scan.openOf.has(i)) continue;
      open++;
      if (!stampOf.has(i)) stampOf.set(i, step);
      const key = stampOf.get(i) * (n + 1) + i;
      if (key < pickKey) { pickKey = key; pick = i; }
    }
    if (pick < 0) return null; // tıkalı — yapısal deadlock
    curve.push(open / alive.size);
    openCellsArr.push(scan.matchCells);
    effort.push(scan.emptyCells / scan.matchCells);
    noise.push(scan.missCells / Math.max(1, scan.matchCells + scan.missCells));
    pickKind.push(isCollinear(pairs[pick]) ? "koridor" : "köşe");
    pickSpan.push(spanOf(pairs[pick]));
    const [[r1, c1], [r2, c2]] = pairs[pick];
    board[r1][c1] = null;
    board[r2][c2] = null;
    alive.delete(pick);
    order.push(pick);
    step++;
  }

  const L = curve.length;
  const seg = (arr, a, b) => {
    const s = arr.slice(Math.floor(L * a), Math.max(Math.floor(L * a) + 1, Math.floor(L * b)));
    return s.reduce((x, y) => x + y, 0) / s.length;
  };
  if (L < 8) {
    return {
      curve, order, effort, noise, openCells: openCellsArr, pickKind, pickSpan,
      start: curve[0], waist: curve[0], waistPos: 0, dip: 1,
      effortStart: effort[0], effortPeak: Math.max(...effort),
      effortPeakPos: effort.indexOf(Math.max(...effort)) / L,
      effortEnd: effort[L - 1],
      cornerShare: pickKind.filter((k) => k === "köşe").length / L,
    };
  }
  const start = seg(curve, 0, 0.2);
  const from = Math.floor(L * 0.3), to = Math.max(from + 1, Math.floor(L * 0.75));
  let waist = Infinity, waistIdx = from;
  for (let i = from; i < to; i++) if (curve[i] < waist) { waist = curve[i]; waistIdx = i; }
  // Efor zirvesi aynı orta bantta aranır (sondaki doğal rahatlamayı saymaz)
  let effortPeak = -Infinity, effortIdx = from;
  for (let i = from; i < to; i++) if (effort[i] > effortPeak) { effortPeak = effort[i]; effortIdx = i; }
  // Belde oynanan hamlelerin köşe payı: düğümün bilişsel yükü
  const midKinds = pickKind.slice(from, to);
  return {
    curve, order, effort, noise, openCells: openCellsArr, pickKind, pickSpan,
    start, waist, waistPos: waistIdx / L, dip: start > 0 ? waist / start : 1,
    effortStart: seg(effort, 0, 0.2),
    effortPeak, effortPeakPos: effortIdx / L,
    effortEnd: seg(effort, 0.8, 1),
    cornerShare: midKinds.filter((k) => k === "köşe").length / midKinds.length,
  };
}

// ── Yerellik: yerel-oyuncu simülasyonu ──
//
// pairsCurve'ün FIFO oyuncusu üretim sırasını ölçer; buradaki oyuncu ise
// akış ARAYAN insanın kaba modelidir: her adımda son tap'ine EN YAKIN açık
// hücreyi oynar. Ölçtüğü şey açıklığın sayısı değil COĞRAFYASI:
//   jump[t]   — son tap → seçilen tap Manhattan mesafesi. Oyuncu hep EN
//               YAKINI oynadığından jump = "en yakın devamın uzaklığı":
//               küçük = akış (devam elinin altında), büyük = yerel devam YOK,
//               oyuncu aramak zorunda — açık çift sayısından bağımsız olarak
//               gerçek bir kilitlenme anı.
//   forced[t] — o an açık çift ≤1 (seçenek de yok; bilgi amaçlı).
// Türetilenler:
//   knots     — DÜĞÜM olayları: jump ≥ knotThr. İyi levelda az sayıda ve
//               ortaya serpilmiş olmalı (knotAt konumları). Çok sayıda düğüm
//               = büyük boardlardaki "dağınıklık" hissinin ta kendisi.
//   grindMax  — ÖĞÜTME: art arda uzak hamle (jump ≥ 3) dizisi maksimumu.
//               Düğüm tek vuruşluktur; 2+ uzak hamle zinciri aramanın
//               ödülsüz tekrarı = tasarım hatası (bkz. 6x8 çerçeve lv18 kuyruğu).
//   tailJump / tailFar — son %20'nin ort. sıçraması ve uzak hamle sayısı:
//               final yerel kapanış kümesi olmalı, saçılmamalı.
//   splitT    — kalan taşların İLK kez ≥2 parçaya (her parça ≥3 taş)
//               bölündüğü an t (yoksa null); maxComps — görülen en çok parça.
//               Adacık/kesme tasarımının "parçalanma gerçekleşti mi" ölçüsü.
// Dönüş null = tıkalı eşleme (pairsCurve null ile aynı durum).
function localityStats(pairs, rows, cols) {
  const n = pairs.length;
  if (n === 0) return null;
  const board = boardFromPairs(rows, cols, pairs);
  const knotThr = Math.max(3, Math.round((rows + cols) / 5));

  // kalan taşların 4-komşuluk parça sayısı (küçük kırıntılar sayılmaz)
  function tileComps() {
    const seen = Array.from({ length: rows }, () => Array(cols).fill(false));
    let comps = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (board[r][c] === null || seen[r][c]) continue;
        let size = 0;
        const q = [[r, c]];
        seen[r][c] = true;
        while (q.length) {
          const [a, b] = q.pop();
          size++;
          for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const rr = a + dr, cc = b + dc;
            if (rr >= 0 && cc >= 0 && rr < rows && cc < cols &&
                board[rr][cc] !== null && !seen[rr][cc]) {
              seen[rr][cc] = true;
              q.push([rr, cc]);
            }
          }
        }
        if (size >= 3) comps++;
      }
    }
    return comps;
  }

  const jumps = [], opens = [], spans = [], forced = [];
  let last = null, splitStep = null, maxComps = 1, alive = n, step = 0;
  while (alive > 0) {
    const cells = availableTapCells(board);
    if (!cells.length) return null; // tıkalı
    const openPairs = new Set();
    for (const cell of cells) for (const id of cell.pairIds) openPairs.add(id);
    let pick = null, bestKey = Infinity;
    for (const cell of cells) {
      const d = last === null
        ? 0
        : Math.abs(cell.r - last[0]) + Math.abs(cell.c - last[1]);
      // eşitlikte çok çift kıran, sonra satır-major (deterministik)
      const key = d * 1e6 - cell.pairIds.length * 1e3 + cell.r * cols + cell.c;
      if (key < bestKey) { bestKey = key; pick = cell; }
    }
    const jump = last === null ? 0 : Math.abs(pick.r - last[0]) + Math.abs(pick.c - last[1]);
    const res = resolveTap(board, pick.r, pick.c);
    jumps.push(jump);
    opens.push(openPairs.size);
    forced.push(openPairs.size <= 1);
    spans.push(Math.max(...res.matches.map((m) => spanOf(m.tiles))));
    applyMatches(board, res.matches);
    alive -= res.matches.length;
    last = [pick.r, pick.c];
    const comps = tileComps();
    if (comps > maxComps) maxComps = comps;
    if (comps >= 2 && splitStep === null) splitStep = step;
    step++;
  }

  const L = jumps.length;
  const splitT = splitStep === null ? null : splitStep / L;
  const knotAt = [];
  let grindMax = 0, run = 0;
  for (let i = 0; i < L; i++) {
    if (jumps[i] >= knotThr) knotAt.push(i / L);
    if (jumps[i] >= 3) { run++; grindMax = Math.max(grindMax, run); }
    else run = 0;
  }
  const tail = Math.floor(L * 0.8);
  let tailJump = 0, tailFar = 0;
  for (let i = tail; i < L; i++) {
    tailJump += jumps[i];
    if (jumps[i] >= 3) tailFar++;
  }
  tailJump /= Math.max(1, L - tail);
  const meanJump = jumps.reduce((a, b) => a + b, 0) / L;

  return {
    jumps, opens, spans, forced,
    meanJump, maxJump: Math.max(...jumps),
    knots: knotAt.length, knotAt, knotThr,
    grindMax, tailJump, tailFar,
    splitT, maxComps,
  };
}

// ── Efor botu: min-efor açgözlü oyuncu (level zorluk profili) ──
//
// pairsCurve'ün eforu alan oranıdır ve FIFO (üretim) sırasını ölçer;
// localityStats yalnız mesafeye bakar. Buradaki bot hamle-başına bir EFOR
// fonksiyonu kurar ve her adımda EN UCUZ hamleyi oynar. Monotonluk sayesinde
// açgözlü bot asla kilitlenmez (çözülebilir level her sırayla biter) → eğri
// hep tamamlanır ve zirvesi "oyuncunun kaçınamayacağı en pahalı an"ın alt
// sınırıdır: levelın maks eforu. (Açgözlülük global-optimal sıra değildir;
// gerçek oyuncu da açgözlü olduğu için bu model kusuru değil özelliğidir.)
//
// Hamle = match veren boş hücre. Bileşenler (hepsi ~0..1; ağırlıklar
// EFFORT_WEIGHTS, kalibrasyon tools/report_effort.js raporuyla):
//   kind    köşe (L) eşleşmesi 1, koridor 0 — L iki cross'un kesişimini
//           kurmayı ister, bilişsel yük (README "köşe payı" ile aynı ayrım)
//   span    çiftin taşları arası Manhattan / (rows+cols) — uzak çift geç görülür
//   corner  hizasızda çözüm hücresi kıtlığı: iki köşe de açık 0.5, tek köşe 1
//           (koridorda 0 — kısa koridorun tek hücresi zaten aşikârdır)
//   dist    son tap'ten hücreye Manhattan / (rows+cols) — yerellik (göz oradaydı)
// Adım-seviyesi terimler (o an TÜM hamlelere ortak; seçimi değil eğrinin
// yüksekliğini etkiler — "herhangi bir match'i bulmak ne kadar zor"):
//   search  1 − match hücre / boş hücre — taranacak alanda iğne oranı
//   noise   miss / (match+miss) — taş gören ama çift vermeyen "yem" hücreler
// Combo: hücre 2 çifti birden kırıyorsa çift-başı terimler ortalanır
// (tek tap iki çift götürür; hız avantajı eğri kısalığında görünür).

var EFFORT_WEIGHTS = {
  kind: 1.0, span: 1.0, corner: 0.5, dist: 1.0, search: 1.0, noise: 0.5,
};

// Kalibrasyon bulgusu (tools/report_effort.js, 1500 etiketli level): zirve
// (effortMax) etiketleri AYIRMAZ — her levelda tavana yakın en az bir an
// var (sınırsız arama terimi denendi, o da ayırmadı: "1 match hücresi /
// çok boş alan" anı easy levelda da olur). Ayıran metrikler yükün SÜRESİ:
//   effortMean    eğri alanı — easy 2.35 < medium 2.53 < hard 2.65 < vh 2.80
//   effortHiShare efor ≥ EFFORT_HI_THR adımların payı — 0.40/0.49/0.57/0.64
// Yani zorluk tek zirveden değil, yüksek eforun ne kadar taşındığından gelir.
var EFFORT_HI_THR = 3.0; // varsayılan ağırlıklara göre "zor adım" eşiği

// Anlık board eforları — efor modelinin TEK ADIMI. Bot (effortCurve) ve
// oyun içi canlı efor göstergesi (js/game.js) aynı hesabı buradan kullanır.
// board mevcut durum (mutate edilmez), last = oyuncunun son tap'i ([r,c]
// ya da null). Dönüş null = match veren hücre yok; aksi halde:
//   cells[]  { r, c, pairIds, move, effort, parts }
//            move   = yalnız hamle terimleri (botun seçim anahtarı)
//            effort = move + adım terimleri (eğriye yazılan değer)
//            parts  = bileşen dökümü { kind, span, corner, dist, search, noise }
//   stepTerm o an tüm hamlelere ortak arama+yem yükü
function boardEfforts(board, pairs, last, weights) {
  const W = Object.assign({}, EFFORT_WEIGHTS, weights || {});
  const rows = board.length, cols = board[0].length;
  const scale = rows + cols; // mesafe normalizasyonu — boyutlar arası karşılaştırılabilir
  const scan = scanBoard(board);
  // openOf (çift → hücreler) ters çevrilir: hücre → kırdığı çiftler
  const cellMap = new Map();
  for (const [pid, cells] of scan.openOf) {
    for (const [r, c] of cells) {
      const k = r * cols + c;
      if (!cellMap.has(k)) cellMap.set(k, { r, c, pairIds: [] });
      cellMap.get(k).pairIds.push(pid);
    }
  }
  if (!cellMap.size) return null; // match hücresi yok
  const searchT = W.search * (1 - scan.matchCells / scan.emptyCells);
  const noiseT = W.noise * (scan.missCells / Math.max(1, scan.matchCells + scan.missCells));
  const stepTerm = searchT + noiseT;
  const cells = [];
  for (const cell of cellMap.values()) {
    let kindT = 0, spanT = 0, cornerT = 0;
    for (const pid of cell.pairIds) {
      const corner = !isCollinear(pairs[pid]);
      kindT += W.kind * (corner ? 1 : 0);
      spanT += (W.span * spanOf(pairs[pid])) / scale;
      if (corner) cornerT += W.corner / scan.openOf.get(pid).length;
    }
    // combo: çift-başı ortalama (tek tap iki çift götürür)
    kindT /= cell.pairIds.length;
    spanT /= cell.pairIds.length;
    cornerT /= cell.pairIds.length;
    const distT = last
      ? (W.dist * (Math.abs(cell.r - last[0]) + Math.abs(cell.c - last[1]))) / scale
      : 0;
    const move = kindT + spanT + cornerT + distT;
    cells.push({
      r: cell.r, c: cell.c, pairIds: cell.pairIds,
      move, effort: move + stepTerm,
      parts: { kind: kindT, span: spanT, corner: cornerT, dist: distT, search: searchT, noise: noiseT },
    });
  }
  return { cells, stepTerm };
}

// Dönüş null = tıkalı (deadlock). Aksi halde:
//   effort[t]  adım eforu (min hamle + adım terimleri)
//   moves[t]   { r, c, pairIds } — botun oynadığı hücre
//   order      kırılan çiftlerin sırası (combo'da ikisi de girer)
//   effortMax / effortMaxPos / effortMean / effortHiShare — zorluk özetleri
function effortCurve(pairs, rows, cols, weights) {
  const n = pairs.length;
  if (n === 0) return null;
  const board = boardFromPairs(rows, cols, pairs);
  const effort = [], moves = [], order = [];
  let last = null, alive = n;
  while (alive > 0) {
    const ef = boardEfforts(board, pairs, last, weights);
    if (!ef) return null; // tıkalı — yapısal deadlock
    let pick = null, pickKey = Infinity;
    for (const cell of ef.cells) {
      const key = cell.r * cols + cell.c; // eşitlikte satır-major (deterministik)
      if (!pick || cell.move < pick.move - 1e-9 ||
          (Math.abs(cell.move - pick.move) <= 1e-9 && key < pickKey)) {
        pick = cell; pickKey = key;
      }
    }
    effort.push(pick.effort);
    moves.push({ r: pick.r, c: pick.c, pairIds: pick.pairIds.slice() });
    for (const pid of pick.pairIds) {
      const [[r1, c1], [r2, c2]] = pairs[pid];
      board[r1][c1] = null;
      board[r2][c2] = null;
      order.push(pid);
    }
    alive -= pick.pairIds.length;
    last = [pick.r, pick.c];
  }
  const L = effort.length;
  let maxI = 0;
  for (let i = 1; i < L; i++) if (effort[i] > effort[maxI]) maxI = i;
  return {
    effort, moves, order,
    effortMax: effort[maxI],
    effortMaxPos: L > 1 ? maxI / (L - 1) : 0,
    effortMean: effort.reduce((a, b) => a + b, 0) / L,
    effortHiShare: effort.filter((x) => x >= EFFORT_HI_THR).length / L,
  };
}

if (typeof module !== "undefined") {
  module.exports = {
    spanOf, isCollinear, pairOptions, analyzeFlow, scanBoard, pairsCurve,
    localityStats, boardEfforts, effortCurve, EFFORT_WEIGHTS, EFFORT_HI_THR,
  };
}
