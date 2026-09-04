"use strict";

// Kalıp Editörü — formülsüz şekil tasarımı: referans gridde (24×16) elle
// boya, bitmap ÇOĞUNLUK örneklemesiyle (TM_SHAPES.sampleBitmap) her board
// boyutuna ölçeklenir. Önizleme şeridi 10 boyutta ada sayısı / alan / kesme
// uyumunu canlı gösterir; "Test üret" seçili boyutta generateFullLevel
// koşturup yerellik metriklerini basar; "Kaydet" localStorage'a yazar
// (lab'ın şekil satırı okur), "DEFS kodu kopyala" js/shapes.js'e
// yapıştırılacak kalıcı girişi üretir.

(function () {
  const $ = (id) => document.getElementById(id);

  // referans tuval: oyun boardlarıyla aynı dikey oran (3:2)
  const BH = 24, BW = 16;
  // oyundaki boyutlar (rows, cols) — levels_shapes.js paket boyutları
  const SIZES = [[8, 6], [9, 6], [9, 7], [10, 7], [10, 8],
                 [12, 8], [14, 8], [12, 9], [15, 9], [18, 12]];

  let bmp = Array.from({ length: BH }, () => Array(BW).fill(false));
  let editingId = null; // kayıtlı kalıp yükliyse üstüne yazar

  // ── boyama gridi ──
  const grid = $("keGrid");
  grid.style.gridTemplateColumns = "repeat(" + BW + ", 22px)";
  const cellEls = [];
  for (let r = 0; r < BH; r++) {
    for (let c = 0; c < BW; c++) {
      const d = document.createElement("div");
      d.className = "kc";
      // simetri eksen kılavuzu: orta sütun/satır hafif koyu
      if (c === BW / 2 - 1 || c === BW / 2 || r === BH / 2 - 1 || r === BH / 2) {
        d.classList.add("ghost");
      }
      d.dataset.r = r; d.dataset.c = c;
      grid.appendChild(d);
      cellEls.push(d);
    }
  }

  function setCell(r, c, v) {
    bmp[r][c] = v;
    // simetri: işaretli eksenlerde aynala
    if ($("keMirV").checked) bmp[r][BW - 1 - c] = v;
    if ($("keMirH").checked) bmp[BH - 1 - r][c] = v;
    if ($("keMirV").checked && $("keMirH").checked) bmp[BH - 1 - r][BW - 1 - c] = v;
  }

  function redraw() {
    for (let r = 0; r < BH; r++) {
      for (let c = 0; c < BW; c++) {
        cellEls[r * BW + c].classList.toggle("on", bmp[r][c]);
      }
    }
    schedulePreviews();
  }

  let painting = false, paintValue = true;
  function cellAt(ev) {
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    if (!el || !el.dataset || el.dataset.r === undefined) return null;
    return [Number(el.dataset.r), Number(el.dataset.c)];
  }
  grid.addEventListener("pointerdown", (ev) => {
    const rc = cellAt(ev);
    if (!rc) return;
    painting = true;
    paintValue = !bmp[rc[0]][rc[1]]; // ilk hücrenin tersi: boyar ya da siler
    setCell(rc[0], rc[1], paintValue);
    redraw();
    grid.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });
  grid.addEventListener("pointermove", (ev) => {
    if (!painting) return;
    const rc = cellAt(ev);
    if (!rc) return;
    setCell(rc[0], rc[1], paintValue);
    redraw();
  });
  const stop = () => { painting = false; };
  grid.addEventListener("pointerup", stop);
  grid.addEventListener("pointercancel", stop);

  // ── araçlar ──
  $("keClear").addEventListener("click", () => {
    bmp = Array.from({ length: BH }, () => Array(BW).fill(false));
    editingId = null;
    redraw();
  });
  $("keFill").addEventListener("click", () => {
    bmp = Array.from({ length: BH }, () => Array(BW).fill(true));
    redraw();
  });
  $("keInvert").addEventListener("click", () => {
    for (let r = 0; r < BH; r++) for (let c = 0; c < BW; c++) bmp[r][c] = !bmp[r][c];
    redraw();
  });

  // şablon: hazır DEFS şekli tuvale bas (üstünde oynanır)
  {
    const sel = $("keTemplate");
    for (const id of TM_SHAPES.ORDER) {
      if (id === "dolu") continue;
      const op = document.createElement("option");
      op.value = id; op.textContent = TM_SHAPES.DEFS[id].name;
      sel.appendChild(op);
    }
  }
  $("keLoadTpl").addEventListener("click", () => {
    const m = TM_SHAPES.maskFor($("keTemplate").value, BH, BW);
    if (!m) return;
    bmp = m.map((row) => row.slice());
    editingId = null;
    redraw();
  });

  // PNG içe aktarma: tuval boyutuna çizilir, alfa+parlaklıkla eşiklenir
  $("kePng").addEventListener("change", (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement("canvas");
      cv.width = BW; cv.height = BH;
      const ctx = cv.getContext("2d");
      ctx.drawImage(img, 0, 0, BW, BH);
      const px = ctx.getImageData(0, 0, BW, BH).data;
      for (let r = 0; r < BH; r++) {
        for (let c = 0; c < BW; c++) {
          const i = (r * BW + c) * 4;
          const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
          bmp[r][c] = px[i + 3] > 128 && lum < 200; // koyu ve opak = taş
        }
      }
      editingId = null;
      redraw();
    };
    img.src = URL.createObjectURL(file);
    ev.target.value = "";
  });

  // ── önizleme şeridi: 10 boyut + tanılar ──
  function comps(mask, rows, cols) {
    const seen = mask.map((row) => row.map(() => false));
    let n = 0, minSize = Infinity;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!mask[r][c] || seen[r][c]) continue;
        n++;
        let size = 0;
        const q = [[r, c]];
        seen[r][c] = true;
        while (q.length) {
          const [a, b] = q.pop();
          size++;
          for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const rr = a + dr, cc = b + dc;
            if (rr >= 0 && cc >= 0 && rr < rows && cc < cols &&
                mask[rr][cc] && !seen[rr][cc]) { seen[rr][cc] = true; q.push([rr, cc]); }
          }
        }
        minSize = Math.min(minSize, size);
      }
    }
    return { n, minSize: n ? minSize : 0 };
  }

  let prevTimer = null;
  function schedulePreviews() {
    clearTimeout(prevTimer);
    prevTimer = setTimeout(renderPreviews, 120);
  }

  function bmpLines() {
    return bmp.map((row) => row.map((b) => (b ? "1" : "0")).join(""));
  }

  function renderPreviews() {
    const wrap = $("kePreviews");
    wrap.innerHTML = "";
    const lines = bmpLines();
    for (const [rows, cols] of SIZES) {
      const { m, area } = TM_SHAPES.sampleBitmap(lines, rows, cols);
      const box = document.createElement("div");
      box.className = "ke-prev";
      const cv = document.createElement("canvas");
      const cs = rows > 14 ? 5 : 7; // hücre pikseli
      cv.width = cols * cs + 1; cv.height = rows * cs + 1;
      const ctx = cv.getContext("2d");
      ctx.fillStyle = "#fffdf9";
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = "#e2725b";
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (m[r][c]) ctx.fillRect(c * cs + 1, r * cs + 1, cs - 1, cs - 1);
        }
      }
      const cc = comps(m, rows, cols);
      const cutV = computeCutLine(m, rows, cols, "dikey");
      const cutH = computeCutLine(m, rows, cols, "yatay");
      const bad = area < 8 ? '<span class="bad">dejenere</span>'
        : cc.minSize < 4 ? '<span class="bad">kırıntı ada</span>' : "";
      const cutTxt = (cutV ? "│" : "") + (cutH ? "─" : "");
      const label = document.createElement("div");
      label.innerHTML = cols + "×" + rows + " · alan " + area +
        " · <span class='" + (cc.n >= 2 ? "ok" : "") + "'>" + cc.n + " ada</span>" +
        (cutTxt ? " · kesme " + cutTxt : "") + (bad ? " · " + bad : "");
      box.appendChild(cv);
      box.appendChild(label);
      wrap.appendChild(box);
    }
  }

  // ── test üretimi ──
  {
    const sel = $("keTestSize");
    for (const [rows, cols] of SIZES) {
      const op = document.createElement("option");
      op.value = rows + "," + cols; op.textContent = cols + "×" + rows;
      sel.appendChild(op);
    }
    sel.value = "10,8";
  }
  let lastTest = null;
  $("keTest").addEventListener("click", () => {
    const [rows, cols] = $("keTestSize").value.split(",").map(Number);
    const { m, area } = TM_SHAPES.sampleBitmap(bmpLines(), rows, cols);
    const out = $("keTestOut");
    if (area < 8) { out.textContent = "kalıp bu boyutta dejenere (alan < 8)"; return; }
    const lv = generateFullLevel({
      rows, cols, mask: m, seed: 777, frontMode: "bolge", knots: 2,
    });
    if (!lv) { out.textContent = "üretilemedi — kalıp bu boyutta soyulamıyor (çok ince/parçalı olabilir)"; return; }
    const l = lv.loc;
    out.innerHTML =
      "çift <b>" + lv.pairs.length + "</b>" +
      " · derinlik <b>" + lv.flow.depth + "</b>" +
      " · sıçrama <b>" + l.meanJump.toFixed(2) + "</b>" +
      " · düğüm <b>" + l.knots + "</b>" +
      (l.knots ? " <small>@" + l.knotAt.map((t) => t.toFixed(2)).join(", ") + "</small>" : "") +
      " · öğütme <b>" + l.grindMax + "</b>" +
      " · kuyruk <b>" + l.tailJump.toFixed(2) + "</b>" +
      (l.splitT !== null ? " · bölünme@ <b>" + l.splitT.toFixed(2) + "</b>" : "");
    lastTest = lv;
    $("kePlay").hidden = false;
  });
  $("kePlay").addEventListener("click", () => {
    if (!lastTest) return;
    localStorage.setItem("tm_lab_level", JSON.stringify({
      name: ($("keName").value.trim() || "Kalıp testi"),
      rows: lastTest.rows, cols: lastTest.cols,
      pairs: lastTest.pairs, seed: lastTest.seed,
      mask: TM_SHAPES.encode(lastTest.mask),
    }));
    window.open("index.html?lab=1", "_blank");
  });

  // ── kaydet / kod / kayıtlı liste ──
  function slug(name) {
    const map = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" };
    return "ozel-" + name.toLowerCase()
      .replace(/[çğıöşü]/g, (ch) => map[ch])
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
  $("keSave").addEventListener("click", () => {
    const name = $("keName").value.trim();
    if (!name) { $("keName").focus(); return; }
    const id = editingId || slug(name);
    TM_SHAPES.saveCustom(id, name, bmpLines());
    editingId = id;
    renderCustomList();
    $("keSave").textContent = "kaydedildi ✓";
    setTimeout(() => ($("keSave").textContent = "Kaydet"), 1200);
  });
  $("keCode").addEventListener("click", () => {
    const name = $("keName").value.trim() || "Özel";
    const id = (editingId || slug(name)).replace(/^ozel-/, "").replace(/-/g, "");
    const code = "    " + id + ": {\n" +
      '      name: "' + name + '",\n' +
      "      bmp: [\n" +
      bmpLines().map((l) => '        "' + l + '",').join("\n") + "\n" +
      "      ],\n    },";
    navigator.clipboard.writeText(code);
    $("keCode").textContent = "kopyalandı ✓";
    setTimeout(() => ($("keCode").textContent = "DEFS kodu kopyala"), 1200);
  });

  function renderCustomList() {
    const wrap = $("keCustomList");
    wrap.innerHTML = "";
    const ids = TM_SHAPES.customIds();
    if (!ids.length) return;
    const lead = document.createElement("span");
    lead.textContent = "kayıtlı:";
    lead.style.cssText = "font-size:12px;color:var(--muted)";
    wrap.appendChild(lead);
    for (const id of ids) {
      const b = document.createElement("button");
      b.className = "chip theme-chip" + (id === editingId ? " on" : "");
      b.textContent = TM_SHAPES.nameOf(id);
      const x = document.createElement("small");
      x.textContent = "✕";
      x.title = "sil";
      x.addEventListener("click", (ev) => {
        ev.stopPropagation();
        TM_SHAPES.deleteCustom(id);
        if (editingId === id) editingId = null;
        renderCustomList();
      });
      b.appendChild(x);
      b.addEventListener("click", () => {
        // düzenlemek için yükle (bitmap referans boyuta örneklenir)
        const bmpSrc = TM_SHAPES.customBmp(id);
        if (!bmpSrc) return;
        const { m } = TM_SHAPES.sampleBitmap(bmpSrc, BH, BW);
        bmp = m.map((row) => row.slice());
        editingId = id;
        $("keName").value = TM_SHAPES.nameOf(id);
        renderCustomList();
        redraw();
      });
      wrap.appendChild(b);
    }
  }

  renderCustomList();
  redraw();
})();
