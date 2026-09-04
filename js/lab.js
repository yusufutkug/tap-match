"use strict";

// Level Lab — üreticiyi tarayıcıda kurcala: parametre → aday üret → eğrileri
// gör → tek tıkla oyna (index.html?lab=1, localStorage üzerinden).
// Amaze GO karşılaştırma analizinden gelen kadranlar: waistPosTarget (bel
// konumu hedefi) ve waistOpenMax (belde mutlak açık çift tavanı).

(function () {
  const $ = (id) => document.getElementById(id);

  // Amaze GO 2500 level ortalama açık-oran eğrisi (20 nokta) — referans
  const AG_REF = [0.20, 0.18, 0.16, 0.15, 0.14, 0.13, 0.12, 0.11, 0.11, 0.11,
                  0.11, 0.11, 0.12, 0.13, 0.14, 0.15, 0.16, 0.18, 0.25, 0.45];

  const PARAMS = [
    { k: "rows", label: "satır", v: 10 },
    { k: "cols", label: "sütun", v: 10 },
    { k: "entryN", label: "giriş", v: 5 },
    { k: "lockedN", label: "kilitli", v: 3 },
    { k: "gateN", label: "kapı", v: 1 },
    { k: "depthMin", label: "derinlik min", v: 5 },
    { k: "depthMax", label: "derinlik max", v: 7 },
    { k: "cornerP", label: "köşe olasılığı", v: 0.75, step: 0.05 },
    { k: "gateCornerP", label: "kapı köşe P", v: 0.35, step: 0.05 },
    { k: "dipMax", label: "dip tavanı", v: 0.5, step: 0.05 },
    { k: "waistPosTarget", label: "bel hedefi (boş=kapalı)", v: "", step: 0.05 },
    { k: "waistOpenMax", label: "bel açık tavanı (boş=kapalı)", v: "" },
    { k: "fillMin", label: "doluluk tabanı (boş=kapalı)", v: "", step: 0.05 },
    { k: "seed", label: "seed", v: 777 },
    { k: "samples", label: "aday sayısı", v: 6 },
    { k: "maxAttempts", label: "deneme tavanı", v: 600 },
  ];

  const PRESETS = [
    { name: "6×6 kolay", p: { rows: 6, cols: 6, entryN: 3, lockedN: 1, gateN: 1, depthMin: 3, depthMax: 4, cornerP: 0.5, waistPosTarget: "", waistOpenMax: "" } },
    { name: "10×10 orta", p: { rows: 10, cols: 10, entryN: 5, lockedN: 3, gateN: 1, depthMin: 5, depthMax: 7, cornerP: 0.75, waistPosTarget: "", waistOpenMax: "" } },
    { name: "10×15 derin", p: { rows: 15, cols: 10, entryN: 6, lockedN: 5, gateN: 1, depthMin: 5, depthMax: 7, cornerP: 0.75, waistPosTarget: 0.4, waistOpenMax: 3 } },
    { name: "12×18 çift kapı", p: { rows: 18, cols: 12, entryN: 7, lockedN: 8, gateN: 2, depthMin: 5, depthMax: 8, cornerP: 0.75, waistPosTarget: 0.42, waistOpenMax: 3 } },
    { name: "AG tarzı basık", p: { rows: 12, cols: 12, entryN: 3, lockedN: 5, gateN: 1, depthMin: 6, depthMax: 8, cornerP: 0.75, waistPosTarget: 0.45, waistOpenMax: 2 } },
  ];

  // ── panel ──

  const paramsEl = $("labParams");
  for (const p of PARAMS) {
    const label = document.createElement("label");
    label.textContent = p.label;
    const input = document.createElement("input");
    input.type = "number";
    input.id = "in_" + p.k;
    input.value = p.v;
    if (p.step) input.step = p.step;
    label.appendChild(input);
    paramsEl.appendChild(label);
  }

  const presetsEl = $("labPresets");
  for (const pr of PRESETS) {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = pr.name;
    b.addEventListener("click", () => {
      for (const [k, v] of Object.entries(pr.p)) $("in_" + k).value = v;
    });
    presetsEl.appendChild(b);
  }

  // ── şekil maskesi seçimi (js/shapes.js) ──
  // Taşlar yalnız şekil içine yerleşir; şekil dışı hücreler kalıcı boş kalır
  // (görüş hattı geçer, tap edilebilir). "Dolu" = maske yok, eski davranış.
  //
  // "Tam dolu" anahtarı üretim modunu değiştirir: şekil içi %100 taşla dolar
  // ve level ileri-soyma ile kurulur (generateFullLevel) — yapı parametreleri
  // (giriş/kilitli/kapı, derinlik, köşe, bel) bu modda devre dışıdır.

  let shapeId = "dolu";
  let fullFill = false;

  // ── soyma akışı kadranları (yalnız tam dolu modda görünür/geçerli) ──
  // Anlamları js/generator.js peelBuild başlığında; boş kadran = rastgele.
  const PEEL_PARAMS = [
    { k: "peelEntryN", label: "giriş sayısı (boş=rastgele)" },
    { k: "peelFrontBias", label: "cephe sadakati 0-1 (boş=1)", step: 0.05 },
    { k: "peelWaistOpen", label: "bel açık hedefi (boş=kapalı)" },
    { k: "peelCornerP", label: "köşe payı 0-1 (boş=rastgele)", step: 0.05 },
    { k: "peelSpanBias", label: "mesafe eğilimi 0-1 (boş=rastgele)", step: 0.05 },
    { k: "peelKnots", label: "düğüm hedefi (boş=kapalı)" },
  ];
  {
    const wrap = $("labPeelParams");
    const addSelect = (id, text, opts) => {
      const label = document.createElement("label");
      label.textContent = text;
      const sel = document.createElement("select");
      sel.id = id;
      for (const [v, txt] of opts) {
        const op = document.createElement("option");
        op.value = v; op.textContent = txt;
        sel.appendChild(op);
      }
      label.appendChild(sel);
      wrap.appendChild(label);
    };
    // cephe modu: select (serbest = disiplin kapalı)
    addSelect("in_peelFrontMode", "cephe modu",
      [["", "serbest"], ["yilan", "yılan (tek cephe)"],
       ["cepheler", "cepheler (giriş başına)"], ["bolge", "bölge sıralı"]]);
    // kesme hattı: açılış hamleleri şekli görünür adalara böler
    addSelect("in_peelCut", "kesme hattı",
      [["", "yok"], ["dikey", "dikey (sütun)"], ["yatay", "yatay (satır)"]]);
    for (const p of PEEL_PARAMS) {
      const label = document.createElement("label");
      label.textContent = p.label;
      const input = document.createElement("input");
      input.type = "number";
      input.id = "in_" + p.k;
      if (p.step) input.step = p.step;
      label.appendChild(input);
      wrap.appendChild(label);
    }
  }
  function readPeelOpts() {
    const num = (k) => {
      const raw = $("in_" + k).value.trim();
      return raw === "" ? undefined : Number(raw);
    };
    return {
      entryN: num("peelEntryN"),
      frontMode: $("in_peelFrontMode").value || null,
      frontBias: num("peelFrontBias"),
      waistOpen: num("peelWaistOpen"),
      cornerP: num("peelCornerP"),
      spanBias: num("peelSpanBias"),
      knots: num("peelKnots"),
      cut: $("in_peelCut").value || null,
    };
  }

  function renderShapeRow() {
    const row = $("labShapes");
    row.innerHTML = "";
    const lead = document.createElement("span");
    lead.textContent = "şekil:";
    lead.style.cssText = "font-size:11.5px;color:var(--muted);align-self:center";
    row.appendChild(lead);
    for (const id of TM_SHAPES.ORDER) {
      const b = document.createElement("button");
      b.className = "chip theme-chip" + (id === shapeId ? " on" : "");
      b.textContent = TM_SHAPES.DEFS[id].name;
      b.addEventListener("click", () => { shapeId = id; renderShapeRow(); });
      row.appendChild(b);
    }
    const bf = document.createElement("button");
    bf.className = "chip theme-chip" + (fullFill ? " on" : "");
    bf.textContent = "Tam dolu: " + (fullFill ? "Açık" : "Kapalı");
    bf.title = "Şekil içi %100 taş — dıştan soyarak biter; yapı parametreleri devre dışı";
    bf.style.marginLeft = "12px";
    bf.addEventListener("click", () => { fullFill = !fullFill; renderShapeRow(); });
    row.appendChild(bf);
    $("labPeelParams").hidden = !fullFill; // soyma kadranları yalnız tam doluda
  }
  renderShapeRow();

  function readOpts() {
    const num = (k) => {
      const raw = $("in_" + k).value.trim();
      return raw === "" ? undefined : Number(raw);
    };
    const o = {};
    for (const p of PARAMS) o[p.k] = num(p.k);
    return o;
  }

  // ── çizimler ──

  function makeCanvas(w, h) {
    const c = document.createElement("canvas");
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr; c.height = h * dpr;
    c.style.width = w + "px"; c.style.height = h + "px";
    c.getContext("2d").scale(dpr, dpr);
    return c;
  }

  function drawCurve(lv, waistPosTarget) {
    const W = 320, H = 96, pad = 6;
    const c = makeCanvas(W, H);
    const ctx = c.getContext("2d");
    const curve = lv.curve.curve, effort = lv.curve.effort;
    const L = curve.length;
    const X = (i, n) => pad + (i / Math.max(1, n - 1)) * (W - 2 * pad);
    const Y = (v) => H - pad - Math.min(1, v) * (H - 2 * pad);

    // AG referansı
    ctx.strokeStyle = "#b9b2a6"; ctx.lineWidth = 1.4; ctx.setLineDash([4, 3]);
    ctx.beginPath();
    AG_REF.forEach((v, i) => (i ? ctx.lineTo(X(i, 20), Y(v)) : ctx.moveTo(X(0, 20), Y(v))));
    ctx.stroke(); ctx.setLineDash([]);

    // efor (kendi zirvesine normalize, sarı)
    const ePk = Math.max(...effort);
    ctx.strokeStyle = "#e8b23a"; ctx.lineWidth = 1.2;
    ctx.beginPath();
    effort.forEach((v, i) => (i ? ctx.lineTo(X(i, L), Y(v / ePk)) : ctx.moveTo(X(0, L), Y(v / ePk))));
    ctx.stroke();

    // açık-oran eğrisi (dolgu + çizgi)
    ctx.beginPath();
    curve.forEach((v, i) => (i ? ctx.lineTo(X(i, L), Y(v)) : ctx.moveTo(X(0, L), Y(v))));
    ctx.strokeStyle = "#e2725b"; ctx.lineWidth = 2; ctx.stroke();
    ctx.lineTo(X(L - 1, L), Y(0)); ctx.lineTo(X(0, L), Y(0)); ctx.closePath();
    ctx.fillStyle = "rgba(226,114,91,0.10)"; ctx.fill();

    // bel işareti + hedef
    const wx = X(Math.round(lv.curve.waistPos * L), L);
    ctx.strokeStyle = "#c33"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(wx, Y(1)); ctx.lineTo(wx, Y(0)); ctx.stroke();
    if (waistPosTarget !== undefined) {
      const tx = X(Math.round(waistPosTarget * L), L);
      ctx.strokeStyle = "#34d399"; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(tx, Y(1)); ctx.lineTo(tx, Y(0)); ctx.stroke();
      ctx.setLineDash([]);
    }
    return c;
  }

  const ROLE_COLOR = { entry: "#34d399", gate: "#f87171", locked: "#60a5fa" };

  function drawBoard(lv) {
    const cell = Math.max(7, Math.min(16, Math.floor(240 / Math.max(lv.cols, lv.rows))));
    const W = lv.cols * cell, H = lv.rows * cell;
    const c = makeCanvas(W + 2, H + 2);
    const ctx = c.getContext("2d");
    ctx.translate(1, 1);
    // şekil dışı hücreler: silik dolgu → silüet önizlemede okunur
    if (lv.mask) {
      ctx.fillStyle = "rgba(120, 108, 90, 0.14)";
      for (let r = 0; r < lv.rows; r++) {
        for (let cc = 0; cc < lv.cols; cc++) {
          if (!lv.mask[r][cc]) ctx.fillRect(cc * cell, r * cell, cell, cell);
        }
      }
    }
    ctx.strokeStyle = "#eee7db"; ctx.lineWidth = 1;
    for (let r = 0; r <= lv.rows; r++) { ctx.beginPath(); ctx.moveTo(0, r * cell); ctx.lineTo(W, r * cell); ctx.stroke(); }
    for (let col = 0; col <= lv.cols; col++) { ctx.beginPath(); ctx.moveTo(col * cell, 0); ctx.lineTo(col * cell, H); ctx.stroke(); }
    lv.pairs.forEach((pair, i) => {
      const color = ROLE_COLOR[(lv.roles || [])[i]] || "#9ca3af";
      const [[r1, c1], [r2, c2]] = pair;
      ctx.strokeStyle = color; ctx.globalAlpha = 0.3; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo((c1 + 0.5) * cell, (r1 + 0.5) * cell);
      ctx.lineTo((c2 + 0.5) * cell, (r2 + 0.5) * cell);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      for (const [r, cc] of pair) {
        const pad = Math.max(1, cell * 0.12);
        ctx.beginPath();
        ctx.roundRect(cc * cell + pad, r * cell + pad, cell - 2 * pad, cell - 2 * pad, cell * 0.2);
        ctx.fill();
      }
    });
    return c;
  }

  // ── aday kartı ──

  function fmt(x, d) { return typeof x === "number" ? x.toFixed(d === undefined ? 2 : d) : "—"; }
  function okBadge(ok) { return ok ? '<span class="m-ok">✓</span>' : '<span class="m-bad">✗</span>'; }

  function renderCard(lv, idx, opts) {
    const div = document.createElement("div");
    div.className = "cand card";
    if (!lv) {
      div.classList.add("fail");
      div.textContent = "#" + (idx + 1) + " — üretilemedi (deneme tavanına takıldı; parametreleri gevşet)";
      return div;
    }
    const scanPk = (1 / Math.max(1e-9, lv.curve.waist)).toFixed(1);
    const info = document.createElement("div");
    info.className = "cand-info";
    info.innerHTML =
      '<div class="cand-title">#' + (idx + 1) +
      "<small>seed " + lv.seed + " · " + lv.attempts + " deneme</small></div>" +
      '<div class="cand-metrics">' +
      "çift <b>" + lv.pairs.length + "</b> · dolgu <b>" + fmt(lv.fill) + "</b>" +
      (lv.mask ? " · şekil alanı <b>" + lv.maskArea + "/" + lv.rows * lv.cols + "</b>" : "") +
      " · derinlik <b>" + lv.flow.depth + "</b> · giriş <b>" + lv.entries + "</b>" +
      " · fitil <b>" + lv.fused + "</b>" +
      " · etkisiz <b>" + lv.inertEntries + "</b> " + okBadge(lv.inertShare <= 0.25) + "<br>" +
      "dip <b>" + fmt(lv.curve.dip) + "</b> " + okBadge(lv.dipOk) +
      " · bel@ <b>" + fmt(lv.curve.waistPos) + "</b>" +
      " · bel açık <b>" + lv.waistOpenAbs + " çift</b> " + okBadge(lv.waistOk) + "<br>" +
      "köşe payı <b>%" + Math.round(lv.curve.cornerShare * 100) + "</b>" +
      " · efor zirvesi <b>" + fmt(lv.curve.effortPeak, 0) + " hücre</b>" +
      " · tarama <b>" + scanPk + " çift</b>" +
      " · son açıklık <b>" + fmt(lv.endOpen) + "</b>" +
      // yerellik satırı (yalnız tam dolu — loc yerel-oyuncu simülasyonu):
      // sıçrama = akış hissi (küçük iyi), düğüm = planlı arama anları,
      // öğütme = art arda zorunlu-uzak (0-1 iyi), bölünme = parçalanma anı
      (lv.loc
        ? "<br>sıçrama <b>" + fmt(lv.loc.meanJump) + "</b>" +
          " · düğüm <b>" + lv.loc.knots + "</b>" +
          (lv.loc.knots ? " <small>@" + lv.loc.knotAt.map((t) => fmt(t)).join(", ") + "</small>" : "") +
          " · öğütme <b>" + lv.loc.grindMax + "</b> " + okBadge(lv.loc.grindMax <= 1) +
          " · kuyruk sıçr. <b>" + fmt(lv.loc.tailJump) + "</b> " + okBadge(lv.loc.tailFar === 0) +
          (lv.loc.splitT !== null
            ? " · bölünme@ <b>" + fmt(lv.loc.splitT) + "</b> (" + lv.loc.maxComps + " parça)"
            : "")
        : "") +
      "</div>";
    const actions = document.createElement("div");
    actions.className = "cand-actions";
    const bPlay = document.createElement("button");
    bPlay.className = "chip"; bPlay.textContent = "▶ Oyna";
    const levelJson = () => {
      const o = { rows: lv.rows, cols: lv.cols, pairs: lv.pairs, seed: lv.seed };
      if (lv.mask) o.mask = TM_SHAPES.encode(lv.mask);
      return o;
    };
    bPlay.addEventListener("click", () => {
      const payload = { name: "Lab #" + (idx + 1), ...levelJson() };
      localStorage.setItem("tm_lab_level", JSON.stringify(payload));
      window.open("index.html?lab=1", "_blank");
    });
    const bJson = document.createElement("button");
    bJson.className = "chip"; bJson.textContent = "JSON kopyala";
    bJson.addEventListener("click", () => {
      navigator.clipboard.writeText(JSON.stringify(levelJson()));
      bJson.textContent = "kopyalandı ✓";
      setTimeout(() => (bJson.textContent = "JSON kopyala"), 1200);
    });
    actions.appendChild(bPlay); actions.appendChild(bJson);
    info.appendChild(actions);

    const caption = (txt) => {
      const s = document.createElement("small");
      s.textContent = txt;
      return s;
    };
    const curveWrap = document.createElement("div");
    curveWrap.className = "curve-wrap";
    curveWrap.appendChild(drawCurve(lv, opts.waistPosTarget));
    curveWrap.appendChild(caption("eğri: açık/kalan (t=0→1)"));

    const prevWrap = document.createElement("div");
    prevWrap.className = "prev-wrap";
    prevWrap.appendChild(drawBoard(lv));
    prevWrap.appendChild(caption(lv.cols + "×" + lv.rows +
      (lv.full ? " · renk = soyma sırası (yeşil erken → mavi geç)" : " yerleşim")));

    div.appendChild(info);
    div.appendChild(curveWrap);
    div.appendChild(prevWrap);
    return div;
  }

  // ── üretim ──

  let running = false;

  async function run() {
    if (running) return;
    running = true;
    $("btnGen").disabled = true;
    const opts = readOpts();
    // seçili şekil maskesi: taşlar şekil içine, dışı kalıcı boş
    opts.mask = TM_SHAPES.maskFor(shapeId, opts.rows, opts.cols);
    const grid = $("candGrid");
    grid.innerHTML = "";
    $("labSummary").textContent = "";
    const baseSeed = (opts.seed === undefined ? Date.now() : opts.seed) >>> 0;
    const n = Math.max(1, opts.samples || 6);
    const results = [];
    for (let i = 0; i < n; i++) {
      $("labProgress").textContent = "üretiliyor… " + (i + 1) + "/" + n;
      await new Promise((r) => setTimeout(r, 15)); // UI nefes alsın
      const t0 = performance.now();
      const seed = (baseSeed + Math.imul(i + 1, 40503)) >>> 0;
      const lv = fullFill
        ? generateFullLevel({
            rows: opts.rows, cols: opts.cols, mask: opts.mask, seed,
            maxAttempts: opts.maxAttempts, ...readPeelOpts(),
          })
        : generateLevel({ ...opts, seed });
      const ms = performance.now() - t0;
      if (lv) results.push({ lv, ms });
      grid.appendChild(renderCard(lv, i, opts));
    }
    const okN = results.length;
    if (okN) {
      const avg = (f) => results.reduce((a, r) => a + f(r.lv), 0) / okN;
      $("labSummary").innerHTML =
        "<b>" + okN + "/" + n + "</b> aday · ort. " +
        "çift <b>" + avg((l) => l.pairs.length).toFixed(1) + "</b> · " +
        "dip <b>" + avg((l) => l.curve.dip).toFixed(2) + "</b> · " +
        "bel@ <b>" + avg((l) => l.curve.waistPos).toFixed(2) + "</b> · " +
        "bel açık <b>" + avg((l) => l.waistOpenAbs).toFixed(1) + "</b> · " +
        "köşe <b>%" + Math.round(avg((l) => l.curve.cornerShare) * 100) + "</b> · " +
        "etkisiz giriş <b>%" + Math.round(avg((l) => l.inertShare) * 100) + "</b> · " +
        "süre <b>" + (results.reduce((a, r) => a + r.ms, 0) / okN / 1000).toFixed(1) + " sn/aday</b>";
    } else {
      $("labSummary").textContent = "Hiç aday üretilemedi — parametreleri gevşet (deneme tavanı, kilitli sayısı, bel kısıtları).";
    }
    $("labProgress").textContent = "";
    $("btnGen").disabled = false;
    running = false;
  }

  $("btnGen").addEventListener("click", run);
})();
