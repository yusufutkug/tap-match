"use strict";

// Tap Match oyun sayfası. Girdi tek tip: hücreye tap.
// - match  → çift(ler) hücreye uçar, çarpışıp patlar (2 çift = combo).
// - miss   → gören taşlar hücreye uçar, kırılmadan geri döner + hata efekti.
// - blank  → hücre pulse.
// - dolu   → taş sallanır.
// Board modeli tap anında güncellenir; animasyonlar görsel katmandır
// (uçuş sürerken yeni tap kabul edilir, çözüm güncel modele göre hesaplanır).

(function () {
  const $ = (id) => document.getElementById(id);
  const STORE_KEY = "tm_done";

  const EMOJIS = [..."🐶🐱🐭🐹🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🐔🐧🐦🐤🦆🦉🐺🐗🐴🦄🐝🦋🐢🐍🐙🦀🐬🦈🦓🦒🐘🦚🦜🍎🍐🍊🍋🍌🍉🍇🍓🍒🍑🥝🥑🥕🌽🍄🧀🍕🍔🍩🍪🍭🍫"];

  const FLY_MS = 190;   // hücreye uçuş süresi (style.css .tile transition ile eş)
  const POP_MS = 230;   // patlama animasyonu süresi
  const BASE_CELL = 64; // board taban hücre boyutu (px); zoom kameradan gelir
  const LIVES = 3;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Oyun listesi = 100 levellik funnel (levels_gen.js). El yapımı öğretici
  // levellar (levels.js) test/lab tarafında kalır, listeye girmez.
  const LEVELS = (typeof TM_GEN_LEVELS !== "undefined") ? TM_GEN_LEVELS.slice() : TM_LEVELS;

  // Lab entegrasyonu: lab.html "Oyna" ile level'ı localStorage'a yazar ve
  // bu sayfayı ?lab=1 ile açar — level listeye eklenir ve otomatik başlar.
  let labLevel = null;
  if (new URLSearchParams(location.search).has("lab")) {
    try { labLevel = JSON.parse(localStorage.getItem("tm_lab_level")); } catch (e) {}
    if (labLevel && labLevel.pairs) {
      labLevel.id = 999;
      labLevel.name = labLevel.name || "Lab";
      LEVELS.push(labLevel);
    } else labLevel = null;
  }

  let game = null;
  let timerId = null;

  // Kamera: pinch zoom + swipe pan (js/camera.js); tap onayı da oradan geçer
  const camera = createCamera($("viewport"), $("camera"));
  window.addEventListener("resize", () => camera.refit());

  function doneSet() {
    try { return new Set(JSON.parse(localStorage.getItem(STORE_KEY) || "[]")); }
    catch (e) { return new Set(); }
  }
  function markDone(id) {
    const s = doneSet();
    s.add(id);
    try { localStorage.setItem(STORE_KEY, JSON.stringify([...s])); } catch (e) {}
  }

  // ── Level seçim ekranı ──

  function renderLevelGrid() {
    const done = doneSet();
    $("packInfo").textContent = LEVELS.length + " level · " + done.size + " tamamlandı";
    const grid = $("levelGrid");
    grid.innerHTML = "";
    for (const lv of LEVELS) {
      const label = lv.meta && lv.meta.label;
      const card = document.createElement("button");
      card.className = "level-card" +
        (label ? " diff-" + label : "") +
        (done.has(lv.id) ? " done" : "");
      card.innerHTML =
        '<span class="lv-id">' + lv.id + " · " + lv.name + "</span>" +
        '<span class="lv-meta">' + lv.cols + "×" + lv.rows + " · " + lv.pairs.length + " çift</span>" +
        (done.has(lv.id) ? '<span class="lv-check">✓</span>' : "");
      card.addEventListener("click", () => startLevel(lv));
      grid.appendChild(card);
    }
  }

  function showList() {
    stopTimer();
    $("playScreen").hidden = true;
    $("levelScreen").hidden = false;
    renderLevelGrid();
  }

  // ── HUD: süre + canlar ──

  function fmtTime(ms) {
    const s = Math.floor(ms / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return mm + ":" + ss;
  }

  function stopTimer() {
    if (timerId) { clearInterval(timerId); timerId = null; }
  }

  function startTimer() {
    stopTimer();
    const tick = () => { $("hudTime").textContent = fmtTime(Date.now() - game.startT); };
    tick();
    timerId = setInterval(tick, 500);
  }

  function renderLives() {
    const el = $("hudLives");
    el.innerHTML = "";
    for (let i = 0; i < LIVES; i++) {
      const h = document.createElement("span");
      h.className = "heart" + (i >= game.lives ? " lost" : "");
      h.textContent = "❤️";
      el.appendChild(h);
    }
  }

  function loseLife() {
    if (game.lives <= 0) return;
    game.lives--;
    const heart = $("hudLives").children[game.lives];
    if (heart) heart.classList.add("breaking");
    if (game.lives === 0) {
      game.over = true;
      stopTimer();
      $("failStats").textContent =
        fmtTime(Date.now() - game.startT) + " · " + game.taps + " tap · " +
        game.alive.size + " çift kaldı";
      // hatalı taşların geri dönüş animasyonu bitince göster
      setTimeout(() => { $("failOverlay").hidden = false; }, FLY_MS * 2 + 250);
    }
  }

  // ── Oyun ekranı ──

  function posEl(el, r, c) {
    el.style.transform = "translate(" + c * 100 + "%, " + r * 100 + "%)";
  }

  function startLevel(lv) {
    const rng = mulberry32(lv.seed ^ 0x5bf03635);
    const perm = shuffle(Array.from({ length: EMOJIS.length }, (_, i) => i), rng);

    game = {
      lv,
      board: boardFromPairs(lv.rows, lv.cols, lv.pairs),
      emojiOf: (pairId) => EMOJIS[perm[pairId % EMOJIS.length]],
      alive: new Set(lv.pairs.map((_, i) => i)),
      tiles: new Map(),   // "r,c" → taş elementi (yalnız canlı taşlar)
      cells: new Map(),   // "r,c" → hücre elementi
      taps: 0,
      mistakes: 0,
      combos: 0,
      lives: LIVES,
      over: false,
      startT: Date.now(),
    };

    $("levelScreen").hidden = true;
    $("playScreen").hidden = false;
    $("winOverlay").hidden = true;
    $("failOverlay").hidden = true;
    $("hudLevel").innerHTML =
      "Level " + lv.id + "<small>" + lv.cols + "×" + lv.rows + "</small>";
    renderLives();
    startTimer();

    const boardEl = $("board");
    boardEl.innerHTML = "";
    // taban piksel boyutu; ekrana sığdırma ve zoom kameranın işi
    const bw = lv.cols * BASE_CELL, bh = lv.rows * BASE_CELL;
    boardEl.style.width = bw + "px";
    boardEl.style.height = bh + "px";
    boardEl.style.fontSize = BASE_CELL * 0.44 + "px";

    const w = 100 / lv.cols + "%", h = 100 / lv.rows + "%";
    for (let r = 0; r < lv.rows; r++) {
      for (let c = 0; c < lv.cols; c++) {
        const cell = document.createElement("button");
        cell.className = "cell";
        cell.style.width = w;
        cell.style.height = h;
        posEl(cell, r, c);
        cell.addEventListener("click", () => onCellTap(r, c));
        game.cells.set(r + "," + c, cell);
        boardEl.appendChild(cell);

        if (game.board[r][c] !== null) {
          const tile = document.createElement("div");
          tile.className = "tile";
          tile.style.width = w;
          tile.style.height = h;
          posEl(tile, r, c);
          tile.innerHTML = '<span class="face">' + game.emojiOf(game.board[r][c]) + "</span>";
          tile._seq = 0; // animasyon jetonu: yeni animasyon eskisinin callback'lerini iptal eder
          game.tiles.set(r + "," + c, tile);
          boardEl.appendChild(tile);
        }
      }
    }
    camera.setContentSize(bw, bh);
    camera.fit();
    refresh();
  }

  function flashCell(key, cls, ms) {
    const cell = game.cells.get(key);
    cell.classList.add(cls);
    setTimeout(() => cell.classList.remove(cls), ms);
  }

  function onCellTap(r, c) {
    if (!game || game.over || game.alive.size === 0) return;
    const key = r + "," + c;
    const res = resolveTap(game.board, r, c);

    if (res.kind === "occupied") {
      const tile = game.tiles.get(key);
      if (tile) {
        tile.classList.add("wiggle");
        setTimeout(() => tile.classList.remove("wiggle"), 280);
      }
      return;
    }

    if (res.kind === "blank") {
      flashCell(key, "pulse", 320);
      return;
    }

    if (res.kind === "miss") {
      game.mistakes++;
      flashCell(key, "miss", FLY_MS * 2 + 200);
      for (const [tr, tc] of res.bounce) flyAndReturn(tr, tc, r, c);
      loseLife();
      refresh();
      return;
    }

    // match
    game.taps++;
    if (res.matches.length >= 2) game.combos++;
    applyMatches(game.board, res.matches);
    for (const m of res.matches) {
      game.alive.delete(m.pairId);
      for (const [tr, tc] of m.tiles) flyAndBreak(tr, tc, r, c);
    }
    flashCell(key, "boom", FLY_MS + POP_MS);
    refresh();

    if (game.alive.size === 0) {
      markDone(game.lv.id);
      stopTimer();
      $("winStats").textContent =
        fmtTime(Date.now() - game.startT) + " · " + game.taps + " tap · " +
        game.mistakes + " hatalı" +
        (game.combos ? " · " + game.combos + " çifte patlama" : "");
      $("btnNext").hidden = !nextLevel();
      setTimeout(() => { $("winOverlay").hidden = false; }, FLY_MS + POP_MS + 150);
    }
  }

  // Eşleşen taş: hücreye uç, orada patla, DOM'dan kalk.
  function flyAndBreak(r0, c0, r, c) {
    const tile = game.tiles.get(r0 + "," + c0);
    if (!tile) return;
    game.tiles.delete(r0 + "," + c0);
    const seq = ++tile._seq;
    tile.classList.add("flying");
    posEl(tile, r, c);
    setTimeout(() => {
      if (tile._seq !== seq) return;
      tile.classList.add("pop");
      setTimeout(() => tile.remove(), POP_MS);
    }, FLY_MS);
  }

  // Eşi çıkmayan taş: hücreye uç, kırılma, yerine dön + hata görünümü.
  function flyAndReturn(r0, c0, r, c) {
    const tile = game.tiles.get(r0 + "," + c0);
    if (!tile) return;
    const seq = ++tile._seq;
    tile.classList.add("flying", "bad");
    posEl(tile, r, c);
    setTimeout(() => {
      if (tile._seq !== seq) return;
      posEl(tile, r0, c0);
    }, FLY_MS + 60);
    setTimeout(() => {
      if (tile._seq !== seq) return;
      tile.classList.remove("flying", "bad");
      tile.classList.add("wiggle");
      setTimeout(() => { if (tile._seq === seq) tile.classList.remove("wiggle"); }, 280);
    }, FLY_MS * 2 + 80);
  }

  function refresh() {
    $("playStats").innerHTML =
      "Kalan <b>" + game.alive.size + "</b>" +
      " · Açık <b>" + availableTapCells(game.board).length + "</b>" +
      " · Tap <b>" + game.taps + "</b>" +
      (game.combos ? " · Combo <b>" + game.combos + "</b>" : "");
  }

  function showHint() {
    if (!game || game.over) return;
    const cells = availableTapCells(game.board);
    if (cells.length === 0) return;
    const pick = cells[Math.floor(Math.random() * cells.length)];
    flashCell(pick.r + "," + pick.c, "hintmark", 900);
  }

  function nextLevel() {
    const i = LEVELS.findIndex((l) => l.id === game.lv.id);
    return i >= 0 && i + 1 < LEVELS.length ? LEVELS[i + 1] : null;
  }

  $("btnBack").addEventListener("click", showList);
  $("btnToList").addEventListener("click", showList);
  $("btnFailList").addEventListener("click", showList);
  $("btnRestart").addEventListener("click", () => { if (game) startLevel(game.lv); });
  $("btnRetry").addEventListener("click", () => { if (game) startLevel(game.lv); });
  $("btnHint").addEventListener("click", showHint);
  $("btnNext").addEventListener("click", () => {
    const nxt = nextLevel();
    if (nxt) startLevel(nxt); else showList();
  });

  if (labLevel) startLevel(labLevel);
  else renderLevelGrid();
})();
