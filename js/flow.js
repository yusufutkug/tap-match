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

// ── Salience (görünürlük) efor modeli — parametresiz alternatif ──
//
// Karma modelin (boardEfforts) ağırlıkları elle seçilidir; bu model eforu
// tamamen board geometrisinden türetir. Tanımlar:
//   kesişim      ≥2 taş gören boş hücre (iki taşın ışını burada buluşur;
//                tap'lenirse taşlar gelir çarpışır — match ya da miss).
//   search point taş-ışını incidence'ı: bir taşın ışını üstündeki hücre,
//                ışın ilerisinde (ya da o hücrede) bir kesişim varsa sayılır
//                — "kesişime kadar olan kısım". Koridorda her hücre iki taşı
//                birden görür → tüm koridor 2'şer sayılır; L'de köşe hücresi
//                2, bacak hücreleri 1'er sayılır (çokluk = hücreyi kesen taş).
//                L-yapısının tarama yolu böylece maliyete yapısal girer.
//   match point  çifti gerçekten kıran hücreler (openOf).
//   efor(hamle)  toplam search point / hamlenin match point sayısı
//                = rastgele tarayan oyuncunun beklenen deneme sayısı (≥ ~2,
//                SINIRSIZ — karma modelin doygunluk problemi yok).
// Combo hücresinde match point'ler kırılan çiftlerin hücre birleşimidir.
//
// Karma modelden ayrıştığı bilinçli nokta: uzun açık koridor burada UCUZdur
// (çok match point = nereye bassan tutar), karma modelde span cezalıdır
// (uzak çift geç fark edilir) — hangisi oyuncu gerçeği, canlı göstergeyle
// test edilir. dist (yerellik) terimi bu modelde yoktur.
//
// Kalibrasyon bulgusu (report_effort --salience): efor ölçeği board ALANIYLA
// büyür (6×8 ort ~38, 12×18 ort ~205 — havuz alanla ölçeklenir); bu yüzden
// boyutlar-arası sabit eşik anlamsızdır, hiShare level'ın KENDİ medyanına
// göre hesaplanır (≥ 2×medyan = zirve adımı). Ham haliyle etiket ayrışması
// karma modelden zayıftır (ort efor boyut içinde çoğu pakette monoton değil).

// Dönüş null = match hücresi yok. cells[]: { r, c, pairIds, matchPts, effort }
function boardSalience(board, pairs) {
  const rows = board.length, cols = board[0].length;
  const scan = scanBoard(board);
  if (!scan.openOf.size) return null;
  // boş hücre başına gören taş sayısı (≥2 = kesişim)
  const seenN = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (board[r][c] === null) seenN[r][c] = visibleTilesFrom(board, r, c).length;
    }
  }
  // search point havuzu: her taş 4 yönde ışınını yürür; ışındaki SON kesişim
  // hücresine kadarki hücre sayısı eklenir (kesişimsiz ışın 0 katar).
  let searchPts = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (board[r][c] === null) continue;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        let rr = r + dr, cc = c + dc, i = 0, last = 0;
        while (rr >= 0 && rr < rows && cc >= 0 && cc < cols && board[rr][cc] === null) {
          i++;
          if (seenN[rr][cc] >= 2) last = i;
          rr += dr; cc += dc;
        }
        searchPts += last;
      }
    }
  }
  // hücre eforları (cellMap inversiyonu boardEfforts ile aynı)
  const cellMap = new Map();
  for (const [pid, cells] of scan.openOf) {
    for (const [r, c] of cells) {
      const k = r * cols + c;
      if (!cellMap.has(k)) cellMap.set(k, { r, c, pairIds: [] });
      cellMap.get(k).pairIds.push(pid);
    }
  }
  const cells = [];
  for (const cell of cellMap.values()) {
    const u = new Set(); // hamlenin match noktaları: çift(ler)i kıran hücreler
    for (const pid of cell.pairIds) {
      for (const [r, c] of scan.openOf.get(pid)) u.add(r * cols + c);
    }
    cells.push({
      r: cell.r, c: cell.c, pairIds: cell.pairIds,
      matchPts: u.size, effort: searchPts / u.size,
    });
  }
  return { cells, searchPts };
}

// ── Tarama (sweep) efor modeli — salience'ın yörüngeli hali ──
//
// Oran modeli (boardSalience) rastgele taramanın BEKLENEN deneme sayısıydı;
// burada tarama süreci simüle edilir: göz son tap'ten (ilk adımda board
// merkezinden) halka halka dışa süpürür (artan Manhattan; eş mesafede
// satır-major), geçtiği search point'leri sayar. Hücrenin maliyeti =
// üstündeki nitelikli incidence sayısı (boardSalience ile AYNI sayım:
// taş-ışını, o hücrede ya da ilerisinde kesişim varsa sayılır) — yem yoğun
// bölge süpürmeyi yavaşlatır, görüşsüz boş hücre bedava geçilir.
//
// Her match hücresinin eforu = ona VARIŞ anındaki kümülatif sayaç. Bot ilk
// bulduğunu oynar (= min efor; satisficing — gerçek oyuncu tüm hamleleri
// sıralamaz, ilk gördüğünü oynar). Salience'ın iki eksiği böyle kapanır:
// yerellik parametresiz geri gelir (efor yerel havuzdan, uzaklık ancak
// gerçekten gerekince maliyete girer) ve ölçek board alanıyla şişmez.

// Ortak hazırlık: seenN (hücre başına gören taş), inc (hücre başına
// NİTELİKLİ incidence: taş-ışını, ışındaki son kesişime kadar +1),
// cellMap (match hücresi → pairIds), searchPts (tüm havuz).
// Dönüş null = match hücresi yok.
function scanPrep(board) {
  const rows = board.length, cols = board[0].length;
  const scan = scanBoard(board);
  if (!scan.openOf.size) return null;
  const seenN = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (board[r][c] === null) seenN[r][c] = visibleTilesFrom(board, r, c).length;
    }
  }
  const inc = Array.from({ length: rows }, () => Array(cols).fill(0));
  let searchPts = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (board[r][c] === null) continue;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const ray = [];
        let rr = r + dr, cc = c + dc, last = -1;
        while (rr >= 0 && rr < rows && cc >= 0 && cc < cols && board[rr][cc] === null) {
          ray.push([rr, cc]);
          if (seenN[rr][cc] >= 2) last = ray.length - 1;
          rr += dr; cc += dc;
        }
        for (let i = 0; i <= last; i++) inc[ray[i][0]][ray[i][1]]++;
        searchPts += last + 1;
      }
    }
  }
  const cellMap = new Map();
  for (const [pid, cells] of scan.openOf) {
    for (const [r, c] of cells) {
      const k = r * cols + c;
      if (!cellMap.has(k)) cellMap.set(k, { r, c, pairIds: [] });
      cellMap.get(k).pairIds.push(pid);
    }
  }
  return { seenN, inc, cellMap, searchPts };
}

// Gezinti sıraları (hepsi deterministik):
// halka süpürme — artan Manhattan (start yoksa board merkezi), eşitlikte
// satır-major.
function sweepOrder(board, start) {
  const rows = board.length, cols = board[0].length;
  const sr = start ? start[0] : (rows - 1) / 2;
  const sc = start ? start[1] : (cols - 1) / 2;
  const order = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (board[r][c] === null) order.push({ r, c, d: Math.abs(r - sr) + Math.abs(c - sc) });
    }
  }
  order.sort((a, b) => a.d - b.d || (a.r * cols + a.c) - (b.r * cols + b.c));
  return order;
}
// düz satır-major (okuyucu bot)
function rasterOrder(board) {
  const order = [];
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[0].length; c++) {
      if (board[r][c] === null) order.push({ r, c });
    }
  }
  return order;
}

// Gezinti sırasına kümülatif maliyet uygula; match hücrelerinin eforu =
// varış anındaki sayaç (vi = gezinti indeksi — hafıza güncellemesi için).
function traverseCells(order, prep, cols, costFn) {
  let cum = 0, vi = 0;
  const cells = [], visited = [];
  for (const cell of order) {
    cum += costFn(cell.r, cell.c);
    visited.push(cell.r * cols + cell.c);
    const mc = prep.cellMap.get(cell.r * cols + cell.c);
    if (mc) cells.push({ r: mc.r, c: mc.c, pairIds: mc.pairIds, effort: cum, vi });
    vi++;
  }
  return { cells, visited };
}

// Dönüş null = match hücresi yok. cells[]: { r, c, pairIds, effort }
// (efor = varışa dek süpürülen search point; hücrenin kendi incidence'ları
// dahil). searchPts = tüm boardın havuzu (bilgi). Oyun içi gösterge ve
// "sweep" botunun ortak hesabı.
function boardSweep(board, pairs, start) {
  const prep = scanPrep(board);
  if (!prep) return null;
  const cols = board[0].length;
  const t = traverseCells(sweepOrder(board, start), prep, cols, (r, c) => prep.inc[r][c]);
  return { cells: t.cells, visited: t.visited, searchPts: prep.searchPts };
}

// ── Bot ailesi — aynı efor tanımı (geçilen search point), farklı arama ──
// psikolojileri. Hepsi deterministik ve parametresiz (memory/mix'in sabitleri
// aşağıda). effortCurve(pairs, rows, cols, null, <botId>) ile koşarlar.
//
//   sweep   yerel süpürücü: son tap'ten halka halka (akış oyuncusu; referans)
//   center  merkezci: HER adım board merkezinden halka (zoom-fit oyuncusu;
//           yerellik hipotezinin kontrol botu)
//   raster  okuyucu: her adım sol üstten satır satır (sistematik taban
//           çizgisi; efor haritası levelin konum önyargısını açığa çıkarır)
//   ray     ışın takipçisi: son tap'e en yakın TAŞtan başlar, taşın 4 ışınını
//           yürütür ("bu taşın eşi nerede?"), eş yoksa sıradaki taşa geçer —
//           hücre değil taş tarayan oyuncu (basılı-tut önizleme dili)
//   memory  hafızalı süpürücü: sweep gibi gezer ama süpürüp "match değil"
//           dediği hücreyi MEMORY_DECAY hamle boyunca yeniden saymaz; taş
//           kalkınca yalnız o taşın satır/sütunu geçersizleşir (görüş 4 yönlü
//           olduğundan bu kural TAM — uzman oyuncu; öğütmeyi doğru ölçer)
//   mix     karışım: MIX yarıçapına dek yerel halka, bulamazsa kalan
//           hücreleri satır-major tarar ("önce elimin altı, sonra sistematik")

var SEARCH_BOTS = ["sweep", "center", "raster", "ray", "memory", "mix"];
var MEMORY_DECAY = 6; // hafıza ömrü (hamle) — çürüme: eski bilgi güvenilmez
var MIX_RADIUS_DIV = 6; // karışım yerel yarıçapı: max(2, (rows+cols)/6)

// Işın takipçisi: taşlar son tap'e mesafe sırasında (eşitlikte satır-major);
// her taşın 4 ışını DIRS sırasında yürünür, nitelikli prefix (son kesişime
// kadar) hücre başına 1 sayar. Match hücresine İLK varışta efor kaydedilir
// (match hücresi kesişim olduğundan her match hücresine mutlaka varılır).
function rayEfforts(board, prep, last) {
  const rows = board.length, cols = board[0].length;
  const sr = last ? last[0] : (rows - 1) / 2;
  const sc = last ? last[1] : (cols - 1) / 2;
  const tiles = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (board[r][c] !== null) tiles.push({ r, c, d: Math.abs(r - sr) + Math.abs(c - sc) });
    }
  }
  tiles.sort((a, b) => a.d - b.d || (a.r * cols + a.c) - (b.r * cols + b.c));
  let cum = 0;
  const seen = new Set(), cells = [];
  for (const t of tiles) {
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const ray = [];
      let rr = t.r + dr, cc = t.c + dc, lastInt = -1;
      while (rr >= 0 && rr < rows && cc >= 0 && cc < cols && board[rr][cc] === null) {
        ray.push([rr, cc]);
        if (prep.seenN[rr][cc] >= 2) lastInt = ray.length - 1;
        rr += dr; cc += dc;
      }
      for (let i = 0; i <= lastInt; i++) {
        cum++;
        const k = ray[i][0] * cols + ray[i][1];
        const mc = prep.cellMap.get(k);
        if (mc && !seen.has(k)) {
          seen.add(k);
          cells.push({ r: mc.r, c: mc.c, pairIds: mc.pairIds, effort: cum });
        }
      }
    }
  }
  return { cells, searchPts: prep.searchPts };
}

// Tek adım: botun gözüyle tüm match hücrelerinin keşif eforları.
// state = { last, step, mem } (effortCurve taşır; canlı gösterge de
// kullanabilir). Dönüş null = match hücresi yok.
function botEfforts(board, pairs, botId, state) {
  const rows = board.length, cols = board[0].length;
  const prep = scanPrep(board);
  if (!prep) return null;
  const last = state ? state.last : null;
  if (botId === "ray") return rayEfforts(board, prep, last);
  let order;
  if (botId === "raster") {
    order = rasterOrder(board);
  } else if (botId === "center") {
    order = sweepOrder(board, null);
  } else if (botId === "mix") {
    // yerel halka (d ≤ R) + kalanlar satır-major
    const R = Math.max(2, Math.round((rows + cols) / MIX_RADIUS_DIV));
    const near = sweepOrder(board, last).filter((c) => c.d <= R);
    const nearSet = new Set(near.map((c) => c.r * cols + c.c));
    order = near.concat(rasterOrder(board).filter((c) => !nearSet.has(c.r * cols + c.c)));
  } else {
    order = sweepOrder(board, last); // sweep, memory
  }
  let costFn = (r, c) => prep.inc[r][c];
  if (botId === "memory" && state && state.mem) {
    costFn = (r, c) => {
      const s = state.mem.get(r * cols + c);
      return s !== undefined && state.step - s <= MEMORY_DECAY ? 0 : prep.inc[r][c];
    };
  }
  const t = traverseCells(order, prep, cols, costFn);
  return { cells: t.cells, visited: t.visited, searchPts: prep.searchPts };
}

// Dönüş null = tıkalı (deadlock). Aksi halde:
//   effort[t]  adım eforu (min hamle + adım terimleri)
//   moves[t]   { r, c, pairIds } — botun oynadığı hücre
//   order      kırılan çiftlerin sırası (combo'da ikisi de girer)
//   effortMax / effortMaxPos / effortMean / effortHiShare — zorluk özetleri
// model: "salience" → boardSalience; SEARCH_BOTS üyesi → botEfforts (weights
// yok sayılır; hiShare eşiği 2×level medyanı — ölçekleri mutlak eşik taşımaz).
function effortCurve(pairs, rows, cols, weights, model) {
  const n = pairs.length;
  if (n === 0) return null;
  const board = boardFromPairs(rows, cols, pairs);
  const isBot = SEARCH_BOTS.indexOf(model) !== -1;
  const state = { last: null, step: 0, mem: new Map() };
  const effort = [], moves = [], order = [];
  let alive = n;
  while (alive > 0) {
    const ef = model === "salience" ? boardSalience(board, pairs)
      : isBot ? botEfforts(board, pairs, model, state)
      : boardEfforts(board, pairs, state.last, weights);
    if (!ef) return null; // tıkalı — yapısal deadlock
    // seçim anahtarı: karma modelde hamle terimleri (adım terimleri ortak);
    // salience'ta efor (payda ortak → maks match point); botlarda efor
    // (min = gezintide İLK bulunan — satisficing oyuncu)
    const keyOf = (cell) => (model ? cell.effort : cell.move);
    let pick = null, pickKey = Infinity;
    for (const cell of ef.cells) {
      const key = cell.r * cols + cell.c; // eşitlikte satır-major (deterministik)
      if (!pick || keyOf(cell) < keyOf(pick) - 1e-9 ||
          (Math.abs(keyOf(cell) - keyOf(pick)) <= 1e-9 && key < pickKey)) {
        pick = cell; pickKey = key;
      }
    }
    effort.push(pick.effort);
    moves.push({ r: pick.r, c: pick.c, pairIds: pick.pairIds.slice() });
    // hafıza: oyuncu pick'e KADAR süpürdüklerini öğrendi (sonrasını görmedi)
    if (model === "memory" && ef.visited && pick.vi !== undefined) {
      for (let i = 0; i <= pick.vi; i++) state.mem.set(ef.visited[i], state.step);
    }
    for (const pid of pick.pairIds) {
      const [[r1, c1], [r2, c2]] = pairs[pid];
      board[r1][c1] = null;
      board[r2][c2] = null;
      order.push(pid);
      // taş kalkınca yalnız satırı/sütunu değişir → o hatlardaki bilgi bayat
      if (model === "memory") {
        for (const k of state.mem.keys()) {
          const kr = Math.floor(k / cols), kc = k % cols;
          if (kr === r1 || kr === r2 || kc === c1 || kc === c2) state.mem.delete(k);
        }
      }
    }
    alive -= pick.pairIds.length;
    state.last = [pick.r, pick.c];
    state.step++;
  }
  const L = effort.length;
  let maxI = 0;
  for (let i = 1; i < L; i++) if (effort[i] > effort[maxI]) maxI = i;
  let hiThr = EFFORT_HI_THR;
  if (model) {
    // salience/sweep ölçeği mutlak eşik taşımaz → level-göreli: 2×medyan
    const sorted = effort.slice().sort((a, b) => a - b);
    hiThr = 2 * sorted[Math.floor(L / 2)];
  }
  return {
    effort, moves, order,
    effortMax: effort[maxI],
    effortMaxPos: L > 1 ? maxI / (L - 1) : 0,
    effortMean: effort.reduce((a, b) => a + b, 0) / L,
    effortHiShare: effort.filter((x) => x >= hiThr).length / L,
  };
}

// ── Efor eğrisi şekil hedefleri ─────────────────────────────────────────
// Efor-hedefli level üretiminin (tools/gen_effort_levels.js) ölçü tarafı.
// Şablon = [t, y] kontrol noktaları (ikisi de 0..1), aralar doğrusal:
//   bel    ortada zirve, sonda rahatlama — funnel hissinin efor karşılığı
//   dalga  iki tepe — gerilim-rahatlama ritmi
var CURVE_TEMPLATES = {
  bel: [[0, 0.30], [0.50, 1.00], [1, 0.30]],
  dalga: [[0, 0.25], [0.30, 1.00], [0.50, 0.35], [0.75, 1.00], [1, 0.30]],
};

// şablonu t'de değerle (kontrol noktaları arası doğrusal interpolasyon)
function templateAt(tpl, t) {
  if (t <= tpl[0][0]) return tpl[0][1];
  for (let i = 1; i < tpl.length; i++) {
    if (t <= tpl[i][0]) {
      const f = (t - tpl[i - 1][0]) / (tpl[i][0] - tpl[i - 1][0]);
      return tpl[i - 1][1] * (1 - f) + tpl[i][1] * f;
    }
  }
  return tpl[tpl.length - 1][1];
}

// Ham efor eğrisi → şablona uzaklık (RMSE, 0 = tam oturma). Sıra:
// 3'lük hareketli ortalamayla yumuşat (ham eğri testere gibi — yumuşatmadan
// şekil uydurmak gürültüyü uydurmak olur), 20 noktalı ortak t eksenine
// örnekle (bot adım sayıları farklı), kendi maksimumuna normalize et
// (bot ölçekleri karşılaştırılamaz), şablonla karşılaştır.
function shapeScore(effort, tpl) {
  const L = effort.length;
  if (!L) return Infinity;
  const sm = effort.map((_, i) => {
    let s = 0, n = 0;
    for (let j = i - 1; j <= i + 1; j++) {
      if (j >= 0 && j < L) { s += effort[j]; n++; }
    }
    return s / n;
  });
  const G = 20;
  const ys = [];
  let mx = 0;
  for (let k = 0; k < G; k++) {
    const x = (k / (G - 1)) * (L - 1);
    const i = Math.floor(x), f = x - i;
    const v = i + 1 < L ? sm[i] * (1 - f) + sm[i + 1] * f : sm[i];
    ys.push(v);
    if (v > mx) mx = v;
  }
  let se = 0;
  for (let k = 0; k < G; k++) {
    const d = (mx > 0 ? ys[k] / mx : 0) - templateAt(tpl, k / (G - 1));
    se += d * d;
  }
  return Math.sqrt(se / G);
}

if (typeof module !== "undefined") {
  module.exports = {
    spanOf, isCollinear, pairOptions, analyzeFlow, scanBoard, pairsCurve,
    localityStats, boardEfforts, boardSalience, boardSweep, botEfforts,
    effortCurve, EFFORT_WEIGHTS, EFFORT_HI_THR, SEARCH_BOTS, MEMORY_DECAY,
    CURVE_TEMPLATES, templateAt, shapeScore,
  };
}
