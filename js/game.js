"use strict";

// Tap Match oyun sayfası. Girdi tek tip: hücreye tap.
// Her boş-hücre tap'i önce 4 yönlü kısa bir scan oynatır (playScan, SCAN_MS);
// ışın ilk taşta durur → görüş/engelleme kuralı görsel olarak öğrenilir.
// - match  → scan sonrası çift(ler) hücreye uçar, çarpışıp patlar + parçacık
//            (2 çift = combo: büyük halka, daha çok parçacık, "Çifte!" yazısı).
// - miss   → scan sonrası gören taşlar hücreye uçup geri döner; soket sallanır,
//            negatif pulse verir, 1 can gider.
// - blank  → scan (hepsi boşa) + hücre pulse.
// - dolu   → taş sallanır.
// Board modeli tap anında güncellenir; animasyonlar görsel katmandır
// (uçuş sürerken yeni tap kabul edilir, çözüm güncel modele göre hesaplanır).

(function () {
  const $ = (id) => document.getElementById(id);
  const STORE_KEY = "tm_done2"; // "size:id" anahtarları (paket başına ilerleme)
  const THEME_KEY = "tm_theme"; // seçili sticker teması (js/themes.js)

  const FLY_MS = 190;   // hücreye uçuş süresi (style.css .tile transition ile eş)
  const POP_MS = 230;   // patlama animasyonu süresi
  const SCAN_MS = 130;  // tap sonrası 4 yönlü tarama süresi; uçuşlar bundan sonra
                        // başlar (style.css .cell.boom gecikmesi = SCAN_MS + FLY_MS)
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

  // Paketler: boyut başına 100 levellik funnel (levels_gen.js TM_PACKS).
  // Oyuncu önce boyutu, sonra leveli seçer. El yapımı öğretici levellar
  // (levels.js) test/lab tarafında kalır, listeye girmez.
  const PACKS = (typeof TM_PACKS !== "undefined")
    ? TM_PACKS
    : [{ size: "el", cols: 0, rows: 0, levels: TM_LEVELS }];

  // Lab entegrasyonu: lab.html "Oyna" ile level'ı localStorage'a yazar ve
  // bu sayfayı ?lab=1 ile açar — level paket dışı oynanır ve otomatik başlar.
  let labLevel = null;
  if (new URLSearchParams(location.search).has("lab")) {
    try { labLevel = JSON.parse(localStorage.getItem("tm_lab_level")); } catch (e) {}
    if (labLevel && labLevel.pairs) {
      labLevel.id = 999;
      labLevel.name = labLevel.name || "Lab";
    } else labLevel = null;
  }

  let game = null;
  let pack = null;          // seçili paket (lab levelinde null)
  let listMode = "pack";    // level listesi: "pack" | "favs"
  let timerId = null;

  // Kamera: pinch zoom + swipe pan (js/camera.js); tap onayı da oradan geçer
  const camera = createCamera($("viewport"), $("camera"));
  window.addEventListener("resize", () => camera.refit());

  function doneSet() {
    try { return new Set(JSON.parse(localStorage.getItem(STORE_KEY) || "[]")); }
    catch (e) { return new Set(); }
  }
  function doneKey(lv) { return (pack ? pack.size : "lab") + ":" + lv.id; }

  // ── Dark mode ──
  // Varsayılan KOYU; düğme tercihi kalıcılaştırır. theme-color meta'sı da
  // güncellenir ki telefonda tarayıcı/durum çubuğu oyuna uysun.

  const DARK_KEY = "tm_dark";
  function applyDark(on) {
    document.body.classList.toggle("dark", on);
    $("btnDark").textContent = on ? "☀️" : "🌙";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", on ? "#1b1a1d" : "#f5f2ec");
  }
  let darkOn = (() => {
    try {
      const s = localStorage.getItem(DARK_KEY);
      if (s !== null) return s === "1";
    } catch (e) {}
    return true;
  })();
  applyDark(darkOn);
  $("btnDark").addEventListener("click", () => {
    darkOn = !darkOn;
    try { localStorage.setItem(DARK_KEY, darkOn ? "1" : "0"); } catch (e) {}
    applyDark(darkOn);
  });

  // ── Tarama efekti (opsiyonel) ──
  // Tap'teki 4 yönlü scan ışınları kapatılabilir; kapalıyken scan beklemesi
  // de kalkar (taşlar anında uçar). Ana ekrandaki çip ile açılıp kapanır.

  const SCAN_KEY = "tm_scan";
  let scanOn = (() => {
    try { return localStorage.getItem(SCAN_KEY) !== "0"; } catch (e) { return true; }
  })();
  const scanDelay = () => (scanOn ? SCAN_MS : 0);
  function applyScanBtn() {
    const b = $("btnScan");
    b.textContent = scanOn ? "Açık" : "Kapalı";
    b.classList.toggle("on", scanOn);
    b.classList.toggle("theme-chip", scanOn); // .theme-chip.on accent görünümü
  }
  applyScanBtn();
  $("btnScan").addEventListener("click", () => {
    scanOn = !scanOn;
    try { localStorage.setItem(SCAN_KEY, scanOn ? "1" : "0"); } catch (e) {}
    applyScanBtn();
  });

  // ── Sticker teması ──

  function currentThemeId() {
    try {
      const id = localStorage.getItem(THEME_KEY);
      if (id && TM_THEMES[id]) return id;
    } catch (e) {}
    return TM_THEME_ORDER[0];
  }
  function setTheme(id) {
    try { localStorage.setItem(THEME_KEY, id); } catch (e) {}
  }

  function renderThemeRow() {
    const row = $("themeRow");
    row.innerHTML = "";
    const cur = currentThemeId();
    for (const id of TM_THEME_ORDER) {
      const t = TM_THEMES[id];
      const b = document.createElement("button");
      b.className = "chip theme-chip" + (id === cur ? " on" : "");
      b.innerHTML = '<span class="theme-sample">' + t.faces[0] + "</span>" + t.name;
      b.addEventListener("click", () => { setTheme(id); renderThemeRow(); });
      row.appendChild(b);
    }
  }
  function markDone(lv) {
    const s = doneSet();
    s.add(doneKey(lv));
    try { localStorage.setItem(STORE_KEY, JSON.stringify([...s])); } catch (e) {}
  }

  // ── Favoriler ──
  // Sevilen leveller "size:id" anahtarıyla saklanır; HUD'daki ve kazanma
  // popup'ındaki kalp ile eklenip çıkarılır, ana ekrandaki ♥ Favoriler
  // kütüphanesinden tekrar oynanır.

  const FAV_KEY = "tm_favs";
  function favSet() {
    try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || "[]")); }
    catch (e) { return new Set(); }
  }
  function favHas(lv) { return favSet().has(doneKey(lv)); }
  function toggleFav(lv) {
    const s = favSet();
    const key = doneKey(lv);
    if (s.has(key)) s.delete(key); else s.add(key);
    try { localStorage.setItem(FAV_KEY, JSON.stringify([...s])); } catch (e) {}
    updateFavButtons();
  }
  function updateFavButtons() {
    if (!game) return;
    const on = favHas(game.lv);
    const b = $("btnFav");
    b.textContent = on ? "♥" : "♡";
    b.classList.toggle("on", on);
    b.title = on ? "Favorilerden çıkar" : "Favorilere ekle";
    // lab levelı pakette yok, kütüphaneye giremez
    b.hidden = !pack;
    const w = $("btnWinFav");
    w.textContent = on ? "♥ Favorilerde" : "♡ Favorilere ekle";
    w.classList.toggle("on", on);
    w.hidden = !pack;
  }

  // ── Boyut seçim ekranı ──

  function renderSizeGrid() {
    const done = doneSet();
    const totalDone = [...done].length;
    $("sizeInfo").textContent =
      PACKS.length + " boyut · " + (PACKS.length * 100) + " level · " + totalDone + " tamamlandı";
    const grid = $("sizeGrid");
    grid.innerHTML = "";
    for (const p of PACKS) {
      const dn = p.levels.filter((lv) => done.has(p.size + ":" + lv.id)).length;
      const card = document.createElement("button");
      card.className = "size-card";
      card.innerHTML =
        '<span class="sz-name">' + p.cols + "×" + p.rows + "</span>" +
        '<span class="sz-meta">' + p.levels.length + " level · " + dn + " tamamlandı</span>" +
        '<span class="sz-bar"><i style="width:' + (100 * dn / p.levels.length) + '%"></i></span>';
      card.addEventListener("click", () => { pack = p; listMode = "pack"; showList(); });
      grid.appendChild(card);
    }
    const favN = favSet().size;
    $("favLibMeta").textContent = favN ? favN + " level" : "henüz boş — oyunda ♡ ile ekle";
    renderThemeRow();
  }

  function showSizes() {
    stopTimer();
    pack = null;
    listMode = "pack";
    $("playScreen").hidden = true;
    $("levelScreen").hidden = true;
    $("sizeScreen").hidden = false;
    renderSizeGrid();
  }

  // ── Level seçim ekranı (seçili boyut ya da favori kütüphanesi) ──

  function levelCard(p, lv, done, showSize) {
    const label = lv.meta && lv.meta.label;
    const key = p.size + ":" + lv.id;
    const card = document.createElement("button");
    card.className = "level-card" +
      (label ? " diff-" + label : "") +
      (done.has(key) ? " done" : "");
    card.innerHTML =
      '<span class="lv-id">' + (showSize ? p.cols + "×" + p.rows + " · " : "") +
        lv.id + " · " + lv.name + "</span>" +
      '<span class="lv-meta">' + lv.pairs.length + " çift</span>" +
      (done.has(key) ? '<span class="lv-check">✓</span>' : "");
    card.addEventListener("click", () => { pack = p; startLevel(lv); });
    return card;
  }

  function renderLevelGrid() {
    const done = doneSet();
    const grid = $("levelGrid");
    grid.innerHTML = "";

    if (listMode === "favs") {
      const favs = favSet();
      let n = 0;
      for (const p of PACKS) {
        for (const lv of p.levels) {
          if (!favs.has(p.size + ":" + lv.id)) continue;
          grid.appendChild(levelCard(p, lv, done, true));
          n++;
        }
      }
      $("packTitle").textContent = "♥ Favoriler";
      $("packInfo").textContent =
        n ? n + " level" : "henüz boş — oyunda ♡ ile ekle";
      return;
    }

    const dn = pack.levels.filter((lv) => done.has(pack.size + ":" + lv.id)).length;
    $("packTitle").textContent = pack.cols + "×" + pack.rows;
    $("packInfo").textContent = pack.levels.length + " level · " + dn + " tamamlandı";
    for (const lv of pack.levels) grid.appendChild(levelCard(pack, lv, done, false));
  }

  function showList() {
    stopTimer();
    if (listMode !== "favs" && !pack) return showSizes();
    $("playScreen").hidden = true;
    $("sizeScreen").hidden = true;
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
    // kalp, scan bitip hata görünür olduktan sonra kırılsın
    if (heart) setTimeout(() => heart.classList.add("breaking"), scanDelay());
    if (game.lives === 0) {
      game.over = true;
      stopTimer();
      $("failStats").textContent =
        fmtTime(Date.now() - game.startT) + " · " + game.taps + " tap · " +
        game.alive.size + " çift kaldı";
      // scan + hatalı taşların geri dönüş animasyonu bitince göster
      setTimeout(() => { $("failOverlay").hidden = false; }, scanDelay() + FLY_MS * 2 + 250);
    }
  }

  // ── Oyun ekranı ──

  function posEl(el, r, c) {
    el.style.transform = "translate(" + c * 100 + "%, " + r * 100 + "%)";
  }

  function startLevel(lv) {
    cancelSight();
    const theme = TM_THEMES[currentThemeId()];
    const rng = mulberry32(lv.seed ^ 0x5bf03635);
    const perm = shuffle(Array.from({ length: theme.faces.length }, (_, i) => i), rng);

    game = {
      lv,
      board: boardFromPairs(lv.rows, lv.cols, lv.pairs),
      faceOf: (pairId) => theme.faces[perm[pairId % theme.faces.length]],
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

    $("sizeScreen").hidden = true;
    $("levelScreen").hidden = true;
    $("playScreen").hidden = false;
    $("winOverlay").hidden = true;
    $("failOverlay").hidden = true;
    $("hudLevel").innerHTML =
      "Level " + lv.id + "<small>" + lv.cols + "×" + lv.rows + " · " + lv.name + "</small>";
    renderLives();
    updateFavButtons();
    startTimer();

    const boardEl = $("board");
    boardEl.innerHTML = "";
    boardEl.className = "board " + theme.boardClass;
    // taban piksel boyutu; ekrana sığdırma ve zoom kameranın işi
    const bw = lv.cols * BASE_CELL, bh = lv.rows * BASE_CELL;
    game.bw = bw;
    game.bh = bh;
    boardEl.style.width = bw + "px";
    boardEl.style.height = bh + "px";
    boardEl.style.fontSize = BASE_CELL * theme.faceScale + "px";
    // patlama halkası çarpışma anında belirsin (tarama ayarına göre değişir)
    boardEl.style.setProperty("--boom-delay", (scanDelay() + FLY_MS) / 1000 + "s");

    const w = 100 / lv.cols + "%", h = 100 / lv.rows + "%";
    for (let r = 0; r < lv.rows; r++) {
      for (let c = 0; c < lv.cols; c++) {
        const cell = document.createElement("button");
        cell.className = "cell";
        cell.style.width = w;
        cell.style.height = h;
        cell.dataset.r = r;
        cell.dataset.c = c;
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
          tile.innerHTML = '<span class="face">' + game.faceOf(game.board[r][c]) + "</span>";
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
    const classes = cls.split(" ");
    cell.classList.add(...classes);
    setTimeout(() => cell.classList.remove(...classes), ms);
  }

  // Hücreden bir yönde ilk taşa (ya da board kenarına) kadar yürü.
  // showSight ve playScan'in ortak ışın geometrisi.
  function castRay(board, r, c, dr, dc) {
    const rows = board.length, cols = board[0].length;
    let rr = r + dr, cc = c + dc;
    while (rr >= 0 && rr < rows && cc >= 0 && cc < cols) {
      if (board[rr][cc] !== null) return { hit: [rr, cc] };
      rr += dr; cc += dc;
    }
    return { hit: null, endR: rr - dr, endC: cc - dc };
  }

  // Tap scan'i: hücreden yayılan hızlı ışın — ilk taşta durur (tık beneği),
  // boş yön board kenarına silik uzanır.
  // Match'te YALNIZ eşleşen yönler çizilir (ödül/netlik); miss ve blank'te
  // 4 yön de çizilir — görüş/engelleme kuralı yanlış tap'lerde öğrenilir.
  // NOT: board henüz mutate edilmeden (applyMatches öncesi) çağrılmalı.
  function playScan(r, c, res) {
    if (!scanOn) return; // efekt kapalı: ışın çizilmez (scanDelay de 0'dır)
    const cs = BASE_CELL;
    const cx = (c + 0.5) * cs, cy = (r + 0.5) * cs;
    const matched = new Set();
    for (const m of res.matches)
      for (const [tr, tc] of m.tiles) matched.add(tr + "," + tc);

    let html = "";
    for (const [dr, dc] of DIRS) {
      const ray = castRay(game.board, r, c, dr, dc);
      const x1 = cx + dc * cs * 0.2, y1 = cy + dr * cs * 0.2;
      let x2, y2;
      if (ray.hit) {
        // ışın taşın kenarında biter (merkezinde değil)
        x2 = (ray.hit[1] + 0.5) * cs - dc * cs * 0.46;
        y2 = (ray.hit[0] + 0.5) * cs - dr * cs * 0.46;
      } else {
        x2 = (ray.endC + 0.5) * cs + dc * cs * 0.5;
        y2 = (ray.endR + 0.5) * cs + dr * cs * 0.5;
      }
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < cs * 0.15) continue; // kenar dibi: çizme
      const rot = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
      const isMatch = ray.hit && matched.has(ray.hit[0] + "," + ray.hit[1]);
      if (matched.size > 0 && !isMatch) continue; // match'te yalnız pair ışınları
      const beamCls = "beam" + (ray.hit ? "" : " open") + (isMatch ? " match" : "");
      html += '<div class="' + beamCls + '" style="left:' + x1.toFixed(1) +
        "px;top:" + (y1 - 1).toFixed(1) + "px;width:" + len.toFixed(1) +
        "px;--rot:" + rot.toFixed(1) + 'deg"></div>';
      if (ray.hit) {
        html += '<span class="tick' + (isMatch ? " match" : "") + '" style="left:' +
          x2.toFixed(1) + "px;top:" + y2.toFixed(1) + 'px"></span>';
      }
    }
    if (!html) return;
    const el = document.createElement("div");
    el.className = "scan";
    el.innerHTML = html;
    $("board").appendChild(el);
    setTimeout(() => el.remove(), 450);
  }

  // Çarpışma parçacıkları: hücre merkezinden dışa saçılan küçük benekler.
  function spawnBurst(r, c, strong) {
    const cs = BASE_CELL;
    const el = document.createElement("div");
    el.className = "burst" + (strong ? " big" : "");
    el.style.left = (c + 0.5) * cs + "px";
    el.style.top = (r + 0.5) * cs + "px";
    const n = strong ? 11 : 6;
    for (let i = 0; i < n; i++) {
      const p = document.createElement("span");
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.7;
      const d = cs * (strong ? 0.72 : 0.48) * (0.7 + Math.random() * 0.5);
      p.style.setProperty("--dx", (Math.cos(a) * d).toFixed(1) + "px");
      p.style.setProperty("--dy", (Math.sin(a) * d).toFixed(1) + "px");
      el.appendChild(p);
    }
    $("board").appendChild(el);
    setTimeout(() => el.remove(), 550);
  }

  // Combo yazısı: hücreden yükselip solar.
  function showFloatText(r, c, txt) {
    const cs = BASE_CELL;
    const el = document.createElement("div");
    el.className = "floattext";
    el.textContent = txt;
    el.style.left = (c + 0.5) * cs + "px";
    el.style.top = (r + 0.5) * cs + "px";
    $("board").appendChild(el);
    setTimeout(() => el.remove(), 750);
  }

  function vibrate(pattern) {
    if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) {} }
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

    // Her boş-hücre tap'i aynı dille başlar: soket aktifleşir + 4 yönlü scan.
    // Sonuç (uçuş/hata) scan bittikten sonra oynar — oyuncu önce kontrolü görür.
    const g = game; // gecikmeli callback'ler level değişince çalışmasın

    if (res.kind === "blank") {
      playScan(r, c, res);
      flashCell(key, "active pulse", 320);
      return;
    }

    if (res.kind === "miss") {
      game.mistakes++;
      playScan(r, c, res);
      flashCell(key, "active", scanDelay() || 120);
      setTimeout(() => {
        if (game !== g) return;
        flashCell(key, "miss", 600);
        for (const [tr, tc] of res.bounce) flyAndReturn(tr, tc, r, c);
        vibrate(35);
      }, scanDelay());
      loseLife();
      refresh();
      return;
    }

    // match
    game.taps++;
    const isCombo = res.matches.length >= 2;
    if (isCombo) game.combos++;
    playScan(r, c, res); // board mutate edilmeden: ışınlar eşleşen taşları görsün
    flashCell(key, "good", scanDelay() + 450); // doğru hücre: soket tap anında yeşil
    applyMatches(game.board, res.matches);
    for (const m of res.matches) game.alive.delete(m.pairId);
    setTimeout(() => {
      if (game !== g) return;
      for (const m of res.matches)
        for (const [tr, tc] of m.tiles) flyAndBreak(tr, tc, r, c);
    }, scanDelay());
    setTimeout(() => {
      if (game !== g) return;
      spawnBurst(r, c, isCombo);
      if (isCombo) showFloatText(r, c, "Çifte!");
      vibrate(isCombo ? [15, 30, 15] : 12);
    }, scanDelay() + FLY_MS);
    flashCell(key, isCombo ? "boom big" : "boom", scanDelay() + FLY_MS + 550);
    refresh();

    if (game.alive.size === 0) {
      markDone(game.lv);
      stopTimer();
      $("winStats").textContent =
        fmtTime(Date.now() - game.startT) + " · " + game.taps + " tap · " +
        game.mistakes + " hatalı" +
        (game.combos ? " · " + game.combos + " çifte patlama" : "");
      $("btnNext").hidden = !nextLevel();
      setTimeout(() => { $("winOverlay").hidden = false; }, scanDelay() + FLY_MS + POP_MS + 150);
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

  // ── Basılı-tut görüş önizlemesi ──
  // Grid çizgisi olmayan sunumda hizayı okutan ana affordance: parmak boş
  // hücrede ~HOLD_MS beklerse hücrenin 4 yön görüşü çizilir — taşa çarpan
  // ışın koyu noktalı, boşa giden silik; gören taşlar noktaya doğru eğilir.
  // Yeni bilgi vermez (taşlar zaten görünür), yalnız okumayı hızlandırır.
  // Parmak TAP_PX'i aşarsa (drag/pinch) ya da kalkarsa önizleme kapanır;
  // tap'in kendisi kameranın click onayından geçen normal yoldan çözülür.
  const HOLD_MS = 160;
  const HOLD_DRIFT_PX = 8; // camera.js TAP_PX ile eş
  let sight = null; // { pid, x0, y0, r, c, timer, el, seen: ["r,c"] }

  function cancelSight() {
    if (!sight) return;
    clearTimeout(sight.timer);
    if (sight.el) sight.el.remove();
    if (game) {
      for (const key of sight.seen) {
        const t = game.tiles.get(key);
        if (t) t.classList.remove("seen");
      }
    }
    sight = null;
  }

  function showSight() {
    if (!sight || !game || game.over) return;
    const { r, c } = sight;
    if (game.board[r][c] !== null) return; // bu arada taş gelmiş olabilir
    const cs = BASE_CELL;
    const cx = (c + 0.5) * cs, cy = (r + 0.5) * cs;
    let lines = "";

    for (const [dr, dc] of DIRS) {
      const ray = castRay(game.board, r, c, dr, dc);
      const hit = ray.hit;
      const x1 = cx + dc * cs * 0.34, y1 = cy + dr * cs * 0.34;
      let x2, y2;
      if (hit) {
        // ışın taşın kenarında biter (merkezinde değil)
        x2 = (hit[1] + 0.5) * cs - dc * cs * 0.46;
        y2 = (hit[0] + 0.5) * cs - dr * cs * 0.46;
        const key = hit[0] + "," + hit[1];
        const tEl = game.tiles.get(key);
        if (tEl) {
          tEl.classList.add("seen");
          tEl.style.setProperty("--lx", dc * -4 + "px");
          tEl.style.setProperty("--ly", dr * -4 + "px");
          sight.seen.push(key);
        }
      } else {
        // boşa giden görüş: board kenarına silik ışın
        x2 = (ray.endC + 0.5) * cs + dc * cs * 0.5;
        y2 = (ray.endR + 0.5) * cs + dr * cs * 0.5;
      }
      if (Math.hypot(x2 - x1, y2 - y1) < cs * 0.2) continue; // kenar dibi: çizme
      lines += '<line class="' + (hit ? "hit" : "open") + '" x1="' + x1.toFixed(1) +
        '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '" />';
    }

    const el = document.createElement("div");
    el.className = "sight";
    const fd = cs * 0.64;
    el.innerHTML =
      '<svg class="rays" width="' + game.bw + '" height="' + game.bh +
      '" viewBox="0 0 ' + game.bw + " " + game.bh + '">' + lines + "</svg>" +
      '<div class="focus" style="left:' + (cx - fd / 2) + "px;top:" + (cy - fd / 2) +
      "px;width:" + fd + "px;height:" + fd + 'px"></div>';
    $("board").appendChild(el);
    sight.el = el;
  }

  $("board").addEventListener("pointerdown", (e) => {
    if (!game || game.over) return;
    if (sight) { cancelSight(); return; } // ikinci parmak = pinch; önizleme yok
    const cell = e.target.closest ? e.target.closest(".cell") : null;
    if (!cell || cell.dataset.r === undefined) return;
    const r = +cell.dataset.r, c = +cell.dataset.c;
    if (game.board[r][c] !== null) return; // dolu hücre: önizleme yok
    sight = {
      pid: e.pointerId, x0: e.clientX, y0: e.clientY, r, c,
      timer: setTimeout(showSight, HOLD_MS), el: null, seen: [],
    };
  });
  window.addEventListener("pointermove", (e) => {
    if (!sight || e.pointerId !== sight.pid) return;
    if (Math.hypot(e.clientX - sight.x0, e.clientY - sight.y0) > HOLD_DRIFT_PX) cancelSight();
  });
  window.addEventListener("pointerup", (e) => {
    if (sight && e.pointerId === sight.pid) cancelSight();
  });
  window.addEventListener("pointercancel", (e) => {
    if (sight && e.pointerId === sight.pid) cancelSight();
  });

  function showHint() {
    if (!game || game.over) return;
    const cells = availableTapCells(game.board);
    if (cells.length === 0) return;
    const pick = cells[Math.floor(Math.random() * cells.length)];
    flashCell(pick.r + "," + pick.c, "hintmark", 900);
  }

  function nextLevel() {
    if (!pack) return null;
    const i = pack.levels.findIndex((l) => l.id === game.lv.id);
    return i >= 0 && i + 1 < pack.levels.length ? pack.levels[i + 1] : null;
  }

  $("btnBack").addEventListener("click", showList);
  $("btnToList").addEventListener("click", showList);
  $("btnFailList").addEventListener("click", showList);
  $("btnSizeBack").addEventListener("click", showSizes);
  $("btnFav").addEventListener("click", () => { if (game) toggleFav(game.lv); });
  $("btnWinFav").addEventListener("click", () => { if (game) toggleFav(game.lv); });
  $("btnFavLib").addEventListener("click", () => { listMode = "favs"; showList(); });
  $("btnRestart").addEventListener("click", () => { if (game) startLevel(game.lv); });
  $("btnRetry").addEventListener("click", () => { if (game) startLevel(game.lv); });
  $("btnHint").addEventListener("click", showHint);
  $("btnNext").addEventListener("click", () => {
    const nxt = nextLevel();
    if (nxt) startLevel(nxt); else showList();
  });

  if (labLevel) startLevel(labLevel);
  else showSizes();
})();
