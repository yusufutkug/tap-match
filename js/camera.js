"use strict";

// Board kamerası — Amaze GO'nun LeanTouch tabanlı kamera modelinin web
// karşılığı: ortografik kamera yerine translate+scale transform katmanı.
//   - fit: board viewporta sığdırılır, bu ölçek = minZoom (FullBoardView)
//   - pinch: iki parmak arası mesafe oranıyla, pinch merkezi sabit kalarak
//     zoom (OnScale); parmak ortalaması kayınca pan
//   - pan: tek parmak / fare sürüklemesi; clamp board kenarının viewport
//     ortasına dek taşmasına izin verir (kenar/köşe ortalanabilir),
//     board viewporttan küçükse ortalanır
//   - tap vs drag: TAP_PX piksel eşiği (tapThreshold) — eşik aşılırsa o
//     gesture'dan doğan click capture aşamasında yutulur, hücre tap'ı olmaz
//   - atalet: bırakınca son hız damping ile söner (SwipeInertia)
//   - fare tekerleği: imleç etrafında zoom (masaüstü)
//
// createCamera(viewport, content) → { setContentSize, fit, refit, destroy }
// content, viewport'un çocuğu olmalı; transform-origin: 0 0 varsayılır.

function createCamera(viewport, content) {
  const TAP_PX = 8;          // tap/drag ayrım eşiği
  const ZOOM_RANGE = 2.2;    // maxZoom = fit × bu (AG: 2.1→4.0 ≈ ×1.9)
  const ZOOM_OUT = 0.8;      // minZoom = fit × bu: fit'in biraz altına inilebilir
  const WHEEL_K = 0.0016;    // tekerlek hassasiyeti
  const DAMPING = 0.93;      // atalet sönümü (kare başına ~60fps)
  const MIN_V = 0.04;        // px/ms: bunun altında atalet durur

  let bw = 0, bh = 0;                 // içerik taban boyutu (px)
  let scale = 1, minS = 0.1, maxS = 4;
  let fitS = 1;                       // boardu tam sığdıran ölçek (açılış)
  let x = 0, y = 0;
  let raf = null;                     // atalet döngüsü

  const pointers = new Map();         // pointerId → {x, y}
  let dragging = false;               // eşik aşıldı mı (bu gesture'da)
  let suppressClick = false;
  let startX = 0, startY = 0;
  let lastX = 0, lastY = 0, lastT = 0;
  let vx = 0, vy = 0;                 // px/ms
  let pinchDist = 0;

  function rect() { return viewport.getBoundingClientRect(); }

  function apply() {
    content.style.transform = "translate(" + x + "px, " + y + "px) scale(" + scale + ")";
  }

  // Tek kural: board her zaman viewport MERKEZ noktasıyla kesişmeli —
  // kenar/köşe ekran ortasına dek sürüklenebilir, board tamamen dışarı
  // kaçamaz. Board viewporttan küçükken de geçerli (fit'te bile pan var);
  // açılış ortalaması fit/refit'ten gelir.
  function clamp() {
    const r = rect();
    const cw = bw * scale, ch = bh * scale;
    const mx = r.width / 2, my = r.height / 2;
    x = Math.max(mx - cw, Math.min(mx, x));
    y = Math.max(my - ch, Math.min(my, y));
  }

  function setContentSize(w, h) { bw = w; bh = h; }

  // Boardu sığdır ve ortala; açılış ölçeği = fit, ama fit'in biraz altına
  // (ZOOM_OUT) da uzaklaşılabilir — board ekranda küçülüp nefes alanı kazanır
  function fit() {
    stopInertia();
    const r = rect();
    const pad = 14;
    fitS = Math.min((r.width - pad) / bw, (r.height - pad) / bh);
    minS = fitS * ZOOM_OUT;
    maxS = fitS * ZOOM_RANGE;
    scale = fitS;
    x = (r.width - bw * scale) / 2;
    y = (r.height - bh * scale) / 2;
    apply();
  }

  // Pencere boyutu değişince mevcut zoom oranını koruyarak yeniden hesapla
  function refit() {
    if (!bw) return;
    const ratio = fitS > 0 ? scale / fitS : 1;
    const r = rect();
    const pad = 14;
    fitS = Math.min((r.width - pad) / bw, (r.height - pad) / bh);
    minS = fitS * ZOOM_OUT;
    maxS = fitS * ZOOM_RANGE;
    scale = Math.min(maxS, Math.max(minS, fitS * ratio));
    clamp();
    apply();
  }

  // (cx, cy) viewport-yerel nokta sabit kalacak şekilde zoom
  function zoomAt(cx, cy, factor) {
    const ns = Math.min(maxS, Math.max(minS, scale * factor));
    if (ns === scale) return;
    const k = ns / scale;
    x = cx - (cx - x) * k;
    y = cy - (cy - y) * k;
    scale = ns;
    clamp();
    apply();
  }

  function panBy(dx, dy) {
    x += dx; y += dy;
    clamp();
    apply();
  }

  function stopInertia() {
    if (raf) { cancelAnimationFrame(raf); raf = null; }
  }

  function startInertia() {
    let prev = performance.now();
    const step = (now) => {
      const dt = now - prev;
      prev = now;
      const px = x, py = y;
      panBy(vx * dt, vy * dt);
      // clamp hızı kesti mi (sınıra çarptık)?
      if (x === px) vx = 0;
      if (y === py) vy = 0;
      const d = Math.pow(DAMPING, dt / 16.7);
      vx *= d; vy *= d;
      if (Math.hypot(vx, vy) > MIN_V) raf = requestAnimationFrame(step);
      else raf = null;
    };
    raf = requestAnimationFrame(step);
  }

  function local(e) {
    const r = rect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  function midAndDist() {
    const pts = [...pointers.values()];
    const mx = (pts[0].x + pts[1].x) / 2, my = (pts[0].y + pts[1].y) / 2;
    return [mx, my, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)];
  }

  function onDown(e) {
    stopInertia();
    const [px, py] = local(e);
    pointers.set(e.pointerId, { x: px, y: py });
    if (pointers.size === 1) {
      dragging = false;
      suppressClick = false;
      startX = px; startY = py;
      lastX = px; lastY = py; lastT = performance.now();
      vx = 0; vy = 0;
    } else if (pointers.size === 2) {
      dragging = true; // pinch başladı: bu gesture tap değil
      suppressClick = true;
      [, , pinchDist] = midAndDist();
    }
  }

  function onMove(e) {
    if (!pointers.has(e.pointerId)) return;
    const [px, py] = local(e);
    const p = pointers.get(e.pointerId);
    const dx = px - p.x, dy = py - p.y;
    p.x = px; p.y = py;

    if (pointers.size === 1) {
      if (!dragging && Math.hypot(px - startX, py - startY) > TAP_PX) {
        dragging = true;
        suppressClick = true;
        viewport.classList.add("dragging");
      }
      if (dragging) {
        panBy(dx, dy);
        const now = performance.now();
        const dt = Math.max(1, now - lastT);
        // hız: kısa pencere üstel karışım (SwipeInertia velocityTimeWindow)
        vx = 0.75 * ((px - lastX) / dt) + 0.25 * vx;
        vy = 0.75 * ((py - lastY) / dt) + 0.25 * vy;
        lastX = px; lastY = py; lastT = now;
      }
    } else if (pointers.size === 2) {
      const [mx, my, dist] = midAndDist();
      if (pinchDist > 0 && dist > 0) zoomAt(mx, my, dist / pinchDist);
      pinchDist = dist;
      panBy(dx / 2, dy / 2); // iki parmak ortalaması kadar kaydır
    }
  }

  function onUp(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 1) {
      // pinch'ten tek parmağa dönüş: pan kaldığı yerden sürer
      const p = [...pointers.values()][0];
      lastX = p.x; lastY = p.y; lastT = performance.now();
      pinchDist = 0;
    }
    if (pointers.size === 0) {
      viewport.classList.remove("dragging");
      if (dragging && Math.hypot(vx, vy) > MIN_V) startInertia();
      dragging = false;
      // suppressClick bu pointer'ın click'i işlendikten sonra sıfırlanır
      setTimeout(() => { suppressClick = false; }, 0);
    }
  }

  function onWheel(e) {
    e.preventDefault();
    stopInertia();
    const [px, py] = local(e);
    zoomAt(px, py, Math.exp(-e.deltaY * WHEEL_K));
  }

  // Eşik aşıldıysa gesture'dan doğan click hücreye ulaşmasın
  function onClickCapture(e) {
    if (suppressClick) {
      e.stopPropagation();
      e.preventDefault();
    }
  }

  viewport.addEventListener("pointerdown", onDown);
  // hareket ve bırakma viewport dışına taşabilir
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  viewport.addEventListener("wheel", onWheel, { passive: false });
  viewport.addEventListener("click", onClickCapture, true);

  function destroy() {
    stopInertia();
    viewport.removeEventListener("pointerdown", onDown);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    viewport.removeEventListener("wheel", onWheel);
    viewport.removeEventListener("click", onClickCapture, true);
  }

  return { setContentSize, fit, refit, destroy };
}

if (typeof module !== "undefined") module.exports = { createCamera };
