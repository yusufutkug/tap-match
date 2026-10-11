"use strict";

// Tap Match level editör — renderer. Veri main'den gelir (preload köprüsü):
// levels (funnel sırasında) + efor haritası (sweep botu, funnel'ı dizen
// metrikle aynı). Thumbnail'ler IntersectionObserver ile tembel çizilir.

const api = window.editorAPI;
const $ = (id) => document.getElementById(id);

const DIFF_NAME = { e: "easy", m: "medium", h: "hard" };
const DIFF_COLOR = { e: "#34d399", m: "#e8b23a", h: "#f87171" };
// tools/export_levels.js ile aynı testere ofsetleri (efor yüzdeliği hedefi)
const SAW = [-0.10, -0.05, 0.00, 0.04, 0.08, -0.12, -0.04, 0.04, 0.12, -0.16];

let levels = [];          // funnel sırasında
const byNo = new Map();   // no → level
const cards = new Map();  // no → kart elementi
let efforts = null;       // no → {mean,max,maxPos,hiShare,curve}
const pct = new Map();    // no → efor yüzdeliği (0..1)
let selected = null;      // seçili level no
const diffOn = { e: true, m: true, h: true };
let sizeSel = "all";

const pairColor = (i) => `hsl(${(i * 137.508) % 360} 62% 58%)`;
const fmtPct = (x) => (x * 100).toFixed(0) + "%";

// ── sticker görselleri (stickers_map.js: sid → kütüphane yolu) ──
// Görseller sid başına bir kez yüklenir; drawBoard hazır olmayanlarla
// karşılaşırsa decode bitince kendini bir kez yeniden çizer.
const IMG_CACHE = new Map();
function stickerImg(sid) {
  if (typeof TM_STICKERS === "undefined") return null;
  const src = TM_STICKERS[sid];
  if (!src) return null;
  let img = IMG_CACHE.get(sid);
  if (!img) {
    img = new Image();
    img.src = "../../sticker_manager/library/" + src;
    IMG_CACHE.set(sid, img);
  }
  return img;
}

// ── board çizimi (r=0 üst satır; lv.stickers varsa gerçek sticker basılır) ──
function drawBoard(cv, lv, maxW, maxH, withText) {
  const cell = Math.max(2, Math.floor(Math.min(maxW / lv.width, maxH / lv.height)));
  const W = cell * lv.width, H = cell * lv.height;
  const dpr = window.devicePixelRatio || 1;
  cv.width = W * dpr; cv.height = H * dpr;
  cv.style.width = W + "px"; cv.style.height = H + "px";
  const g = cv.getContext("2d");
  g.scale(dpr, dpr);
  g.fillStyle = "#1f1e22";
  g.fillRect(0, 0, W, H);

  const grid = Array.from({ length: lv.height }, () => Array(lv.width).fill(null));
  lv.pairs.forEach((pair, i) => {
    for (const [r, c] of pair) grid[r][c] = i;
  });

  const pad = cell >= 10 ? 1 : 0.5;
  const pending = new Set(); // decode bekleyen görseller → tek yeniden çizim
  for (let r = 0; r < lv.height; r++) {
    for (let c = 0; c < lv.width; c++) {
      const x = c * cell, y = r * cell;
      const id = grid[r][c];
      if (id === null) {
        // boş (tap'lenebilir) hücre — soluk nokta
        g.fillStyle = "rgba(255,255,255,0.12)";
        g.beginPath();
        g.arc(x + cell / 2, y + cell / 2, Math.max(0.8, cell * 0.08), 0, Math.PI * 2);
        g.fill();
        continue;
      }
      const rd = Math.min(3, cell * 0.25);
      const img = lv.stickers && cell >= 7 ? stickerImg(lv.stickers[id]) : null;
      if (img && img.complete && img.naturalWidth) {
        // taş zemini + sticker (oran korunarak hücreye sığdırılır)
        g.fillStyle = "rgba(255,255,255,0.92)";
        g.beginPath();
        g.roundRect(x + pad, y + pad, cell - pad * 2, cell - pad * 2, rd);
        g.fill();
        const inset = Math.max(1, cell * 0.08);
        const bw = cell - inset * 2, bh = cell - inset * 2;
        const s = Math.min(bw / img.naturalWidth, bh / img.naturalHeight);
        const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
        g.drawImage(img, x + (cell - dw) / 2, y + (cell - dh) / 2, dw, dh);
        continue;
      }
      if (img) pending.add(img);
      g.fillStyle = pairColor(id);
      g.beginPath();
      g.roundRect(x + pad, y + pad, cell - pad * 2, cell - pad * 2, rd);
      g.fill();
      if (withText && cell >= 16) {
        g.fillStyle = "rgba(0,0,0,0.55)";
        g.font = `700 ${Math.floor(cell * 0.42)}px sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(String(id + 1), x + cell / 2, y + cell / 2 + 0.5);
      }
    }
  }
  if (pending.size && !cv._tmWaiting) {
    cv._tmWaiting = true;
    Promise.allSettled([...pending].map((im) => im.decode().catch(() => {})))
      .then(() => {
        cv._tmWaiting = false;
        // canvas bu arada başka levela geçmiş olabilir (info paneli yeniden
        // kurulur) — DOM'dan koptuysa çizme
        if (cv.isConnected) drawBoard(cv, lv, maxW, maxH, withText);
      });
  }
}

// ── kart ızgarası ──
const io = new IntersectionObserver((entries) => {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    const cv = en.target;
    io.unobserve(cv);
    drawBoard(cv, byNo.get(+cv.dataset.no), 92, 110, false);
  }
}, { root: $("grid"), rootMargin: "200px" });

function buildGrid() {
  const grid = $("grid");
  grid.textContent = "";
  const frag = document.createDocumentFragment();
  for (const lv of levels) {
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.no = lv.no;

    const cv = document.createElement("canvas");
    cv.dataset.no = lv.no;
    // yer tutucu boyut (çizim gelince gerçek orana oturur)
    cv.style.width = "92px";
    cv.style.height = Math.round(92 * lv.height / lv.width) + "px";
    io.observe(cv);

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML =
      `<span class="diffdot ${lv.diff}" title="${DIFF_NAME[lv.diff]}"></span>` +
      `<span class="no">#${lv.no}</span>` +
      `<span class="sz">${lv.width}×${lv.height}</span>`;

    const ef = document.createElement("div");
    ef.className = "effort";
    ef.textContent = "efor —";

    card.append(cv, meta, ef);
    card.addEventListener("click", () => select(lv.no));
    card.addEventListener("dblclick", () => api.play(lv.no));
    frag.appendChild(card);
    cards.set(lv.no, card);
  }
  grid.appendChild(frag);
}

// ── filtreler ──
function levelVisible(lv) {
  if (!diffOn[lv.diff]) return false;
  if (sizeSel !== "all" && `${lv.width}x${lv.height}` !== sizeSel) return false;
  return true;
}

function applyFilter() {
  for (const lv of levels) {
    cards.get(lv.no).style.display = levelVisible(lv) ? "" : "none";
  }
  drawFunnel();
}

// ── seçim + info paneli ──
function select(no, scroll) {
  if (selected !== null && cards.has(selected)) {
    cards.get(selected).classList.remove("sel");
  }
  selected = no;
  const card = cards.get(no);
  card.classList.add("sel");
  if (scroll) card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  renderInfo();
  drawFunnel();
}

function renderInfo() {
  const panel = $("infoPanel");
  const lv = byNo.get(selected);
  if (!lv) return;
  const idx = levels.indexOf(lv);
  const n = levels.length;
  const e = efforts && efforts[lv.no];
  const p = pct.get(lv.no);
  const target = Math.max(0, Math.min(1, idx / (n - 1) + SAW[idx % 10]));
  const tiles = lv.pairs.length * 2;
  const total = lv.width * lv.height;

  // sticker paleti: sid = kategori_renk_sıra → renk/kategori dökümü
  let stickerRow = "";
  if (lv.stickers && lv.stickers.length) {
    const colors = new Map(), cats = new Map();
    for (const sid of lv.stickers) {
      const parts = sid.split("_");
      const color = parts[parts.length - 2];
      const cat = parts.slice(0, -2).join("_");
      colors.set(color, (colors.get(color) || 0) + 1);
      cats.set(cat, (cats.get(cat) || 0) + 1);
    }
    const fmt = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])
      .map(([k, v]) => k + "×" + v).join(" · ");
    const kind = colors.size === 1 ? " <b>(MONO)</b>"
      : colors.size === 2 ? " <b>(DUO)</b>" : "";
    stickerRow =
      `<span class="k">renkler${kind}</span><span class="v">${fmt(colors)}</span>` +
      `<span class="k">kategoriler</span><span class="v">${fmt(cats)}</span>`;
  }
  // funnel düzeni: 1-4 öğretici, 5-10 giriş, 11+ ana döngü (decade/pos
  // 10 kaydırmayla hesaplanır — assign_stickers ile aynı matematik)
  const slotTag = lv.no <= 4 ? "öğretici"
    : lv.no <= 10 ? "giriş"
    : `decade ${Math.floor((lv.no - 11) / 10) + 1} · pos ${((lv.no - 11) % 10) + 1}`;

  panel.innerHTML = `
    <div class="info-head">
      <div>
        <div class="title">#${lv.no} · ${lv.width}×${lv.height} ·
          <span style="color:${DIFF_COLOR[lv.diff]}">${DIFF_NAME[lv.diff]}</span></div>
        <div class="file">${lv.file}</div>
      </div>
      <button class="btn-edit" id="btnEdit">✏️ Düzenle</button>
      <button class="btn-play" id="btnPlay">▶ Oyna</button>
    </div>
    <canvas id="preview"></canvas>
    <div class="stats">
      <span class="k">çift / taş</span><span class="v">${lv.pairs.length} / ${tiles}</span>
      <span class="k">boş hücre</span><span class="v">${total - tiles}</span>
      <span class="k">doluluk</span><span class="v">${fmtPct(tiles / total)}</span>
      <span class="k">funnel slotu</span><span class="v">${idx + 1} / ${n} · ${slotTag}</span>
      ${stickerRow}
      <span class="k">efor ort <small>(sweep)</small></span>
        <span class="v">${e && e.mean != null ? "<b>" + e.mean.toFixed(1) + "</b>" : "—"}</span>
      <span class="k">efor maks</span>
        <span class="v">${e && e.mean != null ? e.max.toFixed(1) + " @" + fmtPct(e.maxPos) : "—"}</span>
      <span class="k">eşik-üstü adım payı</span>
        <span class="v">${e && e.mean != null ? fmtPct(e.hiShare) : "—"}</span>
      <span class="k">efor yüzdeliği</span>
        <span class="v">${p != null ? "<b>" + fmtPct(p) + "</b>" : "—"}</span>
      <span class="k">slot hedefi (testere)</span><span class="v">${fmtPct(target)}</span>
    </div>
    <div class="curve-title">levelın adım-adım efor eğrisi (bot oynanışı)</div>
    <canvas id="levelCurve"></canvas>
  `;
  $("btnPlay").addEventListener("click", () => api.play(lv.no));
  $("btnEdit").addEventListener("click", () => window.tmEdit.open(lv));
  drawBoard($("preview"), lv, 360, 400, true);
  drawLevelCurve(e);
}

function drawLevelCurve(e) {
  const cv = $("levelCurve");
  if (!cv) return;
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext("2d");
  g.scale(dpr, dpr);
  g.clearRect(0, 0, W, H);
  if (!e || !e.curve || !e.curve.length) {
    g.fillStyle = "#9b97a0";
    g.font = "11px sans-serif";
    g.fillText("efor hesaplanıyor…", 4, 16);
    return;
  }
  const mx = Math.max(...e.curve) || 1;
  const L = e.curve.length;
  const xAt = (i) => (L > 1 ? (i / (L - 1)) * (W - 8) + 4 : W / 2);
  const yAt = (v) => H - 6 - (v / mx) * (H - 14);
  // ortalama çizgisi
  g.strokeStyle = "rgba(255,255,255,0.18)";
  g.setLineDash([3, 3]);
  g.beginPath();
  g.moveTo(4, yAt(e.mean));
  g.lineTo(W - 4, yAt(e.mean));
  g.stroke();
  g.setLineDash([]);
  // eğri
  g.strokeStyle = "#8b5cf6";
  g.lineWidth = 1.6;
  g.beginPath();
  e.curve.forEach((v, i) => (i ? g.lineTo(xAt(i), yAt(v)) : g.moveTo(xAt(i), yAt(v))));
  g.stroke();
}

// ── funnel eforu grafiği (yüzdelik uzayı, export_levels.js mantığı) ──
function drawFunnel() {
  const cv = $("funnelChart");
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext("2d");
  g.scale(dpr, dpr);
  g.clearRect(0, 0, W, H);
  const n = levels.length;
  if (!n) return;
  const xAt = (i) => (i / (n - 1)) * (W - 10) + 5;
  const yAt = (p) => H - 8 - p * (H - 16);

  // testere hedef eğrisi
  g.strokeStyle = "rgba(255,255,255,0.22)";
  g.lineWidth = 1;
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const t = Math.max(0, Math.min(1, i / (n - 1) + SAW[i % 10]));
    i ? g.lineTo(xAt(i), yAt(t)) : g.moveTo(xAt(i), yAt(t));
  }
  g.stroke();

  // level yüzdelik noktaları (filtre dışı soluk)
  if (pct.size) {
    for (let i = 0; i < n; i++) {
      const lv = levels[i];
      const p = pct.get(lv.no);
      if (p == null) continue;
      g.globalAlpha = levelVisible(lv) ? 0.9 : 0.12;
      g.fillStyle = DIFF_COLOR[lv.diff];
      g.fillRect(xAt(i) - 1, yAt(p) - 1, 2, 2);
    }
    g.globalAlpha = 1;
  } else {
    g.fillStyle = "#9b97a0";
    g.font = "11px sans-serif";
    g.fillText("efor hesaplanıyor…", 6, 14);
  }

  // seçim imleci
  if (selected !== null) {
    const i = levels.indexOf(byNo.get(selected));
    if (i >= 0) {
      g.strokeStyle = "#e2725b";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(xAt(i), 4);
      g.lineTo(xAt(i), H - 4);
      g.stroke();
      const p = pct.get(selected);
      if (p != null) {
        g.beginPath();
        g.arc(xAt(i), yAt(p), 3.5, 0, Math.PI * 2);
        g.stroke();
      }
    }
  }
}

$("funnelChart").addEventListener("click", (ev) => {
  const n = levels.length;
  if (!n) return;
  const rect = ev.target.getBoundingClientRect();
  const i = Math.round(((ev.clientX - rect.left - 5) / (rect.width - 10)) * (n - 1));
  const lv = levels[Math.max(0, Math.min(n - 1, i))];
  select(lv.no, true);
});

// ── efor sonuçlarını karta/panele işle ──
function applyEfforts() {
  // yüzdelik: efor sırası (export_levels.js ile aynı — eşitlikte funnel sırası)
  const order = levels
    .filter((lv) => efforts[lv.no] && efforts[lv.no].mean != null)
    .sort((a, b) => efforts[a.no].mean - efforts[b.no].mean || a.no - b.no);
  order.forEach((lv, rank) => {
    pct.set(lv.no, order.length > 1 ? rank / (order.length - 1) : 0);
  });

  for (const lv of levels) {
    const e = efforts[lv.no];
    const el = cards.get(lv.no).querySelector(".effort");
    if (!e || e.mean == null) { el.textContent = "efor ?"; continue; }
    const p = pct.get(lv.no);
    el.textContent = "efor " + e.mean.toFixed(1) + " · " + fmtPct(p);
    // yüzdelik renk şeridi: yeşil (kolay) → kırmızı (zor)
    el.style.background = `hsl(${120 - p * 120} 45% 30% / 0.55)`;
    el.style.color = "#eceae6";
  }
  drawFunnel();
  if (selected !== null) renderInfo();
}

// ── kontroller ──
for (const btn of document.querySelectorAll(".dtoggle")) {
  btn.addEventListener("click", () => {
    const d = btn.dataset.diff;
    diffOn[d] = !diffOn[d];
    btn.classList.toggle("on", diffOn[d]);
    applyFilter();
  });
}

$("sizeFilter").addEventListener("change", (e) => {
  sizeSel = e.target.value;
  applyFilter();
});

$("search").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const no = parseInt(e.target.value, 10);
  if (byNo.has(no)) select(no, true);
});

document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || selected === null) return;
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  e.preventDefault();
  const dir = e.key === "ArrowRight" ? 1 : -1;
  let i = levels.indexOf(byNo.get(selected));
  // filtreye takılmayan bir sonraki level
  for (i += dir; i >= 0 && i < levels.length; i += dir) {
    if (levelVisible(levels[i])) { select(levels[i].no, true); break; }
  }
});

window.addEventListener("resize", () => {
  drawFunnel();
  if (selected !== null && efforts) drawLevelCurve(efforts[selected]);
});

// ── açılış ──
(async () => {
  $("status").textContent = "leveller okunuyor…";
  levels = await api.loadLevels();
  for (const lv of levels) byNo.set(lv.no, lv);

  // boyut filtresi seçenekleri
  const sizes = [...new Set(levels.map((l) => `${l.width}x${l.height}`))]
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b));
  for (const s of sizes) {
    const o = document.createElement("option");
    o.value = s;
    o.textContent = s.replace("x", "×");
    $("sizeFilter").appendChild(o);
  }

  buildGrid();
  // editörden kayıt sonrası reload: kaydedilen level seçili gelsin
  const restore = parseInt(sessionStorage.getItem("tm_restore") || "", 10);
  sessionStorage.removeItem("tm_restore");
  if (byNo.has(restore)) select(restore, true);
  drawFunnel();
  $("status").textContent = levels.length + " level · efor hesaplanıyor…";

  api.onEffortProgress(({ done, total }) => {
    $("status").textContent = `efor hesaplanıyor ${done}/${total}`;
  });
  efforts = await api.computeEfforts();
  $("status").textContent = levels.length + " level · efor hazır ✓";
  applyEfforts();
})();
