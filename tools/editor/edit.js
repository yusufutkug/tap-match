"use strict";

// Manuel level editörü — tam ekran overlay (#editOverlay).
//
// Etkileşim: boş hücreye sol tık çiftin İLK taşını koyar (bekleyen taş),
// ikinci sol tık eşini koyup çifti tamamlar. Taşa tık çifti seçer, sürükleme
// taşı boş hücreye taşır, sağ tık çifti siler. ⌘Z/⇧⌘Z geri al/yinele.
//
// Canlı doğrulama sayfaya script etiketiyle yüklenen js/board.js +
// js/flow.js globalleriyle: analyzeFlow → kilitli (deadlock) çiftler kırmızı
// çerçevelenir; level çözülebilirse effortCurve(…, "sweep") — funnel'ı dizen
// metrikle AYNI — efor ort/maks ve adım eğrisini verir.
//
// Kaydet → main "level:save" export_levels/{no}_{diff}.json'a
// tools/export_levels.js formatında yazar, sayfa yenilenir ve kaydedilen
// level galeride seçili gelir (sessionStorage tm_restore, bkz. editor.js).
//
// editor.js'in script-scope tanımları ($, api, pairColor) burada görünür.

(() => {
  const ov = $("editOverlay");
  const cv = $("edBoard");

  const st = {
    w: 7, h: 9,
    pairs: [],       // [[[r,c],[r,c]], …] — r=0 üst satır (iç temsil)
    pending: null,   // yerleştirilmiş ilk taş [r,c]
    sel: null,       // seçili çift indeksi
    undo: [], redo: [],
    bad: new Set(),  // kilitli çift indeksleri (analyzeFlow.deadlocked)
    flow: null, effort: null,
    drag: null,      // {at:[r,c], t:{pi,ti}|null, moved:bool}
    hover: null,
  };
  let cell = 40; // px, layout() hesaplar

  const deep = (pairs) => pairs.map((p) => p.map(([r, c]) => [r, c]));
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  function tileAt(r, c) {
    for (let pi = 0; pi < st.pairs.length; pi++) {
      for (let ti = 0; ti < 2; ti++) {
        const [tr, tc] = st.pairs[pi][ti];
        if (tr === r && tc === c) return { pi, ti };
      }
    }
    return null;
  }

  // ── aç / kapat ──
  async function openNew() {
    st.w = 7; st.h = 9; st.pairs = [];
    $("edNo").value = await api.nextNo();
    $("edDiff").value = "m";
    $("editTitle").textContent = "yeni level";
    show();
  }

  function open(lv) {
    st.w = lv.width; st.h = lv.height; st.pairs = deep(lv.pairs);
    $("edNo").value = lv.no;
    $("edDiff").value = lv.diff;
    $("editTitle").textContent = "#" + lv.no + " düzenleniyor";
    show();
  }

  function show() {
    st.pending = null; st.sel = null;
    st.undo = []; st.redo = [];
    st.drag = null; st.hover = null;
    $("edW").value = st.w; $("edH").value = st.h;
    ov.hidden = false;
    layout();
    validate();
  }

  function close() {
    if (st.undo.length &&
        !confirm("Kaydedilmemiş değişiklikler var — kapatılsın mı?")) return;
    ov.hidden = true;
  }

  // ── geri al / yinele (boyut da snapshot'ta — resize geri alınabilir) ──
  const snap = () => JSON.stringify({ w: st.w, h: st.h, pairs: st.pairs });

  function snapshot() {
    st.undo.push(snap());
    if (st.undo.length > 200) st.undo.shift();
    st.redo.length = 0;
  }

  function applySnap(s) {
    const o = JSON.parse(s);
    st.w = o.w; st.h = o.h; st.pairs = o.pairs;
    st.pending = null; st.sel = null;
    $("edW").value = st.w; $("edH").value = st.h;
    layout();
    validate();
  }

  function undo() {
    if (!st.undo.length) return;
    st.redo.push(snap());
    applySnap(st.undo.pop());
  }

  function redo() {
    if (!st.redo.length) return;
    st.undo.push(snap());
    applySnap(st.redo.pop());
  }

  // ── boyutlandırma / çizim ──
  function layout() {
    const wrap = cv.parentElement;
    const availW = Math.max(60, wrap.clientWidth - 32);
    const availH = Math.max(60, wrap.clientHeight - 32);
    cell = clamp(Math.floor(Math.min(availW / st.w, availH / st.h)), 14, 72);
    const dpr = window.devicePixelRatio || 1;
    cv.width = cell * st.w * dpr;
    cv.height = cell * st.h * dpr;
    cv.style.width = cell * st.w + "px";
    cv.style.height = cell * st.h + "px";
    draw();
  }

  function drawTile(g, r, c, pi, alpha) {
    const x = c * cell, y = r * cell;
    const pad = Math.max(1.5, cell * 0.07);
    const rd = Math.min(6, cell * 0.22);
    g.globalAlpha = alpha;
    g.fillStyle = pairColor(pi);
    g.beginPath();
    g.roundRect(x + pad, y + pad, cell - pad * 2, cell - pad * 2, rd);
    g.fill();
    if (st.bad.has(pi)) {
      g.strokeStyle = "#f87171";
      g.lineWidth = 2.5;
      g.stroke();
    }
    if (st.sel === pi) {
      g.strokeStyle = "#ffffff";
      g.lineWidth = 2;
      g.stroke();
    }
    if (cell >= 18) {
      g.fillStyle = "rgba(0,0,0,0.55)";
      g.font = `700 ${Math.floor(cell * 0.4)}px sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(String(pi + 1), x + cell / 2, y + cell / 2 + 0.5);
    }
    g.globalAlpha = 1;
  }

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = cell * st.w, H = cell * st.h;
    g.clearRect(0, 0, W, H);
    g.fillStyle = "#1f1e22";
    g.fillRect(0, 0, W, H);

    // ızgara çizgileri
    g.strokeStyle = "rgba(255,255,255,0.07)";
    g.lineWidth = 1;
    for (let c = 1; c < st.w; c++) {
      g.beginPath(); g.moveTo(c * cell + 0.5, 0); g.lineTo(c * cell + 0.5, H); g.stroke();
    }
    for (let r = 1; r < st.h; r++) {
      g.beginPath(); g.moveTo(0, r * cell + 0.5); g.lineTo(W, r * cell + 0.5); g.stroke();
    }

    // hover vurgusu
    if (st.hover) {
      const [hr, hc] = st.hover;
      g.fillStyle = "rgba(255,255,255,0.06)";
      g.fillRect(hc * cell, hr * cell, cell, cell);
    }

    // taşlar (sürüklenen taş atlanır, hayaleti aşağıda)
    const dragging = st.drag && st.drag.moved && st.drag.t;
    st.pairs.forEach((pair, pi) => {
      for (let ti = 0; ti < 2; ti++) {
        if (dragging && st.drag.t.pi === pi && st.drag.t.ti === ti) {
          drawTile(g, pair[ti][0], pair[ti][1], pi, 0.25); // eski yer, soluk
          continue;
        }
        drawTile(g, pair[ti][0], pair[ti][1], pi, 1);
      }
    });

    // sürükleme hayaleti — boş hücre üstündeyse
    if (dragging && st.hover && !tileAt(st.hover[0], st.hover[1])) {
      drawTile(g, st.hover[0], st.hover[1], st.drag.t.pi, 0.65);
    }

    // bekleyen ilk taş — sıradaki çift renginde, kesikli çerçeve
    if (st.pending) {
      const [r, c] = st.pending;
      drawTile(g, r, c, st.pairs.length, 0.55);
      g.strokeStyle = "#e2725b";
      g.lineWidth = 2;
      g.setLineDash([4, 3]);
      g.strokeRect(c * cell + 1.5, r * cell + 1.5, cell - 3, cell - 3);
      g.setLineDash([]);
    }
  }

  // ── doğrulama + yan panel ──
  function validate() {
    st.bad = new Set();
    st.flow = null;
    st.effort = null;
    if (st.pairs.length) {
      st.flow = analyzeFlow(st.pairs, st.h, st.w);
      for (const i of st.flow.deadlocked) st.bad.add(i);
      if (!st.bad.size) {
        st.effort = effortCurve(st.pairs, st.h, st.w, null, "sweep");
      }
    }
    renderSide();
    draw();
  }

  function renderSide() {
    const n = st.pairs.length, tiles = n * 2, total = st.w * st.h;
    const el = $("edStatus");
    if (!n) {
      el.className = "ed-status";
      el.textContent = "Boş board — bir hücreye tıklayıp çiftin ilk taşını koy.";
    } else if (st.bad.size) {
      el.className = "ed-status bad";
      el.textContent = "✗ " + st.bad.size + " çift kilitli — kırmızı çerçeveliler hiç açılamaz.";
    } else {
      el.className = "ed-status ok";
      el.textContent = "✓ Çözülebilir · bağımlılık derinliği " + st.flow.depth;
    }
    $("edStats").innerHTML =
      `<span class="k">çift / taş</span><span class="v">${n} / ${tiles}</span>` +
      `<span class="k">boş hücre</span><span class="v">${total - tiles}</span>` +
      `<span class="k">doluluk</span><span class="v">${total ? Math.round((tiles / total) * 100) : 0}%</span>` +
      `<span class="k">efor ort (sweep)</span><span class="v">${st.effort ? "<b>" + st.effort.effortMean.toFixed(1) + "</b>" : "—"}</span>` +
      `<span class="k">efor maks</span><span class="v">${st.effort ? st.effort.effortMax.toFixed(1) : "—"}</span>`;
    drawCurve();
  }

  function drawCurve() {
    const cvc = $("edCurve");
    const dpr = window.devicePixelRatio || 1;
    const W = cvc.clientWidth, H = cvc.clientHeight;
    cvc.width = W * dpr; cvc.height = H * dpr;
    const g = cvc.getContext("2d");
    g.scale(dpr, dpr);
    g.clearRect(0, 0, W, H);
    const e = st.effort;
    if (!e || !e.effort.length) {
      g.fillStyle = "#9b97a0";
      g.font = "11px sans-serif";
      g.fillText(st.pairs.length ? "efor eğrisi yok (kilitli)" : "efor eğrisi", 6, 16);
      return;
    }
    const mx = Math.max(...e.effort) || 1;
    const L = e.effort.length;
    const xAt = (i) => (L > 1 ? (i / (L - 1)) * (W - 10) + 5 : W / 2);
    const yAt = (v) => H - 6 - (v / mx) * (H - 14);
    g.strokeStyle = "rgba(255,255,255,0.18)";
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(5, yAt(e.effortMean));
    g.lineTo(W - 5, yAt(e.effortMean));
    g.stroke();
    g.setLineDash([]);
    g.strokeStyle = "#8b5cf6";
    g.lineWidth = 1.6;
    g.beginPath();
    e.effort.forEach((v, i) => (i ? g.lineTo(xAt(i), yAt(v)) : g.moveTo(xAt(i), yAt(v))));
    g.stroke();
  }

  // ── düzenleme işlemleri ──
  function click([r, c]) {
    const t = tileAt(r, c);
    if (t) { // taş: çifti seç / seçimi kaldır
      st.pending = null;
      st.sel = st.sel === t.pi ? null : t.pi;
      draw();
      return;
    }
    if (st.pending) {
      if (st.pending[0] === r && st.pending[1] === c) { // aynı hücre: iptal
        st.pending = null;
        draw();
        return;
      }
      snapshot();
      st.pairs.push([st.pending, [r, c]]);
      st.sel = st.pairs.length - 1;
      st.pending = null;
      validate();
    } else {
      st.pending = [r, c];
      st.sel = null;
      draw();
    }
  }

  function removePair(pi) {
    snapshot();
    st.pairs.splice(pi, 1);
    if (st.sel === pi) st.sel = null;
    else if (st.sel !== null && st.sel > pi) st.sel--;
    st.pending = null;
    validate();
  }

  function resizeBoard() {
    const w = clamp(parseInt($("edW").value, 10) || st.w, 3, 14);
    const h = clamp(parseInt($("edH").value, 10) || st.h, 3, 20);
    $("edW").value = w; $("edH").value = h;
    if (w === st.w && h === st.h) return;
    const dropped = st.pairs.filter((p) => p.some(([r, c]) => r >= h || c >= w)).length;
    if (dropped && !confirm(dropped + " çift yeni boyutun dışında kalıyor ve silinecek. Devam?")) {
      $("edW").value = st.w; $("edH").value = st.h;
      return;
    }
    snapshot();
    st.w = w; st.h = h;
    st.pairs = st.pairs.filter((p) => p.every(([r, c]) => r < h && c < w));
    st.pending = null; st.sel = null;
    layout();
    validate();
  }

  // ── fare ──
  function cellAt(ev) {
    const rect = cv.getBoundingClientRect();
    const c = Math.floor((ev.clientX - rect.left) / cell);
    const r = Math.floor((ev.clientY - rect.top) / cell);
    if (r < 0 || r >= st.h || c < 0 || c >= st.w) return null;
    return [r, c];
  }

  cv.addEventListener("mousedown", (ev) => {
    if (ev.button !== 0) return;
    const at = cellAt(ev);
    if (!at) return;
    st.drag = { at, t: tileAt(at[0], at[1]), moved: false };
  });

  cv.addEventListener("mousemove", (ev) => {
    const at = cellAt(ev);
    st.hover = at;
    if (st.drag && st.drag.t && at &&
        (at[0] !== st.drag.at[0] || at[1] !== st.drag.at[1])) {
      st.drag.moved = true;
    }
    draw();
  });

  cv.addEventListener("mouseleave", () => { st.hover = null; draw(); });

  window.addEventListener("mouseup", (ev) => {
    if (ev.button !== 0 || !st.drag) return;
    const drag = st.drag;
    st.drag = null;
    const at = ev.target === cv ? cellAt(ev) : null;
    if (drag.moved) { // sürükle-bırak: taşı boş hücreye taşı
      if (drag.t && at && !tileAt(at[0], at[1])) {
        snapshot();
        st.pairs[drag.t.pi][drag.t.ti] = at;
        st.sel = drag.t.pi;
        validate();
      } else {
        draw();
      }
      return;
    }
    if (at) click(at);
  });

  cv.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    const at = cellAt(ev);
    if (!at) return;
    const t = tileAt(at[0], at[1]);
    if (t) removePair(t.pi);
    else { st.pending = null; draw(); }
  });

  // ── klavye (capture: overlay açıkken galerinin ok tuşları çalışmasın) ──
  document.addEventListener("keydown", (ev) => {
    if (ov.hidden) return;
    const mod = ev.metaKey || ev.ctrlKey;
    if (mod && ev.key.toLowerCase() === "z") {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.shiftKey) redo(); else undo();
      return;
    }
    const inField = ev.target.tagName === "INPUT" || ev.target.tagName === "SELECT";
    if (!inField) {
      if (ev.key === "Escape") {
        if (st.pending) { st.pending = null; draw(); }
        else if (st.sel !== null) { st.sel = null; draw(); }
        else close();
      } else if (ev.key === "Backspace" || ev.key === "Delete") {
        if (st.sel !== null) removePair(st.sel);
      }
    } else if (ev.key === "Enter" && (ev.target.id === "edW" || ev.target.id === "edH")) {
      ev.target.blur();
    }
    ev.stopPropagation();
  }, true);

  // ── kontroller ──
  $("btnNew").addEventListener("click", openNew);
  $("edClose").addEventListener("click", close);
  $("edUndo").addEventListener("click", undo);
  $("edRedo").addEventListener("click", redo);
  $("edW").addEventListener("change", resizeBoard);
  $("edH").addEventListener("change", resizeBoard);

  $("edClear").addEventListener("click", () => {
    if (!st.pairs.length) return;
    if (!confirm("Boarddaki tüm çiftler silinsin mi?")) return;
    snapshot();
    st.pairs = [];
    st.pending = null; st.sel = null;
    validate();
  });

  $("edPlay").addEventListener("click", () => {
    if (!st.pairs.length) return alert("Board boş — önce taş yerleştir.");
    if (st.bad.size &&
        !confirm("Kilitli çiftler var; level bitirilemez. Yine de denensin mi?")) return;
    api.playCustom({
      width: st.w, height: st.h, pairs: st.pairs,
      name: "Editör · #" + $("edNo").value,
    });
  });

  $("edSave").addEventListener("click", async () => {
    const no = parseInt($("edNo").value, 10);
    const diff = $("edDiff").value;
    if (!no || no < 1) return alert("Geçerli bir level numarası gir.");
    if (!st.pairs.length) return alert("Board boş — kaydedilecek bir şey yok.");
    if (st.bad.size &&
        !confirm("Kilitli çiftler var (level çözülemez). Yine de kaydedilsin mi?")) return;
    const payload = { no, diff, width: st.w, height: st.h, pairs: st.pairs };
    let res = await api.saveLevel(payload);
    if (res.exists) {
      if (!confirm(res.exists + " zaten var — üzerine yazılsın mı?")) return;
      res = await api.saveLevel({ ...payload, overwrite: true });
    }
    // galeri taze veriyle yeniden yüklensin, kaydedilen seçili gelsin
    sessionStorage.setItem("tm_restore", String(no));
    location.reload();
  });

  window.addEventListener("resize", () => { if (!ov.hidden) layout(); });

  // editor.js (galeri) + smoke test buradan erişir
  window.tmEdit = {
    open, openNew, close,
    tap: (r, c) => click([r, c]),
    pairCount: () => st.pairs.length,
  };
})();
