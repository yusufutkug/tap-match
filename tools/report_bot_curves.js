"use strict";

// Bot ailesi efor grafikleri — 6 arama botu (js/flow.js SEARCH_BOTS) her
// leveli oynar; level başına tüm botların efor eğrileri (her eğri KENDİ
// maksimumuna normalize, x = hamle sırası 0→1) tek grafikte üst üste çizilir
// → bot_curves.html (üretilen dosya, elle düzenleme). Varsayılan seçki:
// paket başına her diff'ten ortadaki level (4 grafik/paket). Konsola ayrıca
// bot × diff ayrışma özeti basılır (klasik ve tam dolu ayrı).
//
// Çalıştırma:
//   node tools/report_bot_curves.js                  # tüm paketler, seçki
//   TM_SIZES=9x12 node tools/report_bot_curves.js    # seçili paketler
//   node tools/report_bot_curves.js --level 9x12:37  # tek level (tüm botlar)

const fs = require("fs");
const path = require("path");
const { readPack } = require("./pack_io.js");
const { effortCurve, CURVE_TEMPLATES, templateAt } = require("../js/flow.js");

const BOTS = [
  { id: "sweep", name: "yerel", color: "#8b5cf6" },
  { id: "center", name: "merkezci", color: "#0ea5e9" },
  { id: "raster", name: "okuyucu", color: "#ef4444" },
  { id: "ray", name: "ışın", color: "#f59e0b" },
  { id: "memory", name: "hafızalı", color: "#10b981" },
  { id: "mix", name: "karışım", color: "#78716c" },
];

const LEVELS_DIR = path.join(__dirname, "..", "levels");
const DIFFS = ["easy", "medium", "hard", "veryhard"];
const allSizes = fs.readdirSync(LEVELS_DIR).filter((d) =>
  fs.existsSync(path.join(LEVELS_DIR, d, "pack.json")));
const sizes = process.env.TM_SIZES
  ? process.env.TM_SIZES.split(",").map((s) => s.trim()).filter(Boolean)
  : allSizes.sort();

// --level size:id → yalnız o level
const li = process.argv.indexOf("--level");
const only = li !== -1 ? process.argv[li + 1].split(":") : null;

// SVG çok-eğrili grafik: her eğri kendi maksimumuna normalize (şekil
// karşılaştırması; mutlak değerler alt lejantta). tpl verilirse hedef
// şablon kesikli çizgiyle çizilir (efor hedefli paketler).
function chart(curves, tpl) {
  const W = 340, H = 130, pad = 8;
  let svg = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '">';
  svg += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#fffdf9"/>';
  if (tpl) {
    const pts = [];
    for (let k = 0; k <= 40; k++) {
      const t = k / 40;
      pts.push((pad + t * (W - 2 * pad)).toFixed(1) + "," +
        (H - pad - templateAt(tpl, t) * (H - 2 * pad)).toFixed(1));
    }
    svg += '<polyline fill="none" stroke="#2c2a26" stroke-width="1.4" ' +
      'stroke-dasharray="5 4" opacity="0.55" points="' + pts.join(" ") + '"/>';
  }
  for (const cv of curves) {
    const L = cv.effort.length;
    const mx = Math.max(...cv.effort);
    const pts = cv.effort.map((v, i) => {
      const x = pad + (L > 1 ? i / (L - 1) : 0) * (W - 2 * pad);
      const y = H - pad - (mx > 0 ? v / mx : 0) * (H - 2 * pad);
      return x.toFixed(1) + "," + y.toFixed(1);
    });
    svg += '<polyline fill="none" stroke="' + cv.color +
      '" stroke-width="1.6" opacity="0.85" points="' + pts.join(" ") + '"/>';
  }
  return svg + "</svg>";
}

// efor paketlerinde şablon id'den bilinir (gen_effort_levels düzeni:
// 1-10 bel, 11-20 dalga) — kesikli hedef çizgisi grafiğe eklenir
function tplOf(pk, lv) {
  if (!pk.size.startsWith("efor-")) return null;
  return lv.id <= 10 ? "bel" : "dalga";
}

function levelCard(pk, lv) {
  const curves = [], legend = [];
  for (const b of BOTS) {
    const ec = effortCurve(lv.pairs, pk.rows, pk.cols, null, b.id);
    if (!ec) return null;
    curves.push({ effort: ec.effort, color: b.color });
    legend.push('<span><i style="background:' + b.color + '"></i>' + b.name +
      " <b>" + ec.effortMean.toFixed(1) + "</b> <small>maks " +
      Math.round(ec.effortMax) + " · " + ec.effort.length + " adım</small></span>");
  }
  const tplId = tplOf(pk, lv);
  return '<div class="card"><div class="cap"><b>lv ' + lv.id + "</b> · " + lv.diff +
    (tplId ? " · hedef: " + tplId : "") +
    " · " + lv.pairs.length + " çift</div>" +
    chart(curves, tplId ? CURVE_TEMPLATES[tplId] : null) +
    '<div class="lg">' + legend.join("") + "</div></div>";
}

// varsayılan seçki: paket başına her diff'ten ORTADAKİ level; efor
// paketlerinde şablon başına orta + en sert reçete (5, 10, 15, 20)
function pickLevels(pk) {
  if (pk.size.startsWith("efor-")) {
    return pk.levels.filter((l) => [5, 10, 15, 20].includes(l.id));
  }
  const out = [];
  for (const d of DIFFS) {
    const of = pk.levels.filter((l) => l.diff === d);
    if (of.length) out.push(of[Math.floor(of.length / 2)]);
  }
  return out;
}

const t0 = Date.now();
let html =
  '<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8">' +
  "<title>Tap Match — bot efor eğrileri</title><style>" +
  "body{font:14px/1.5 -apple-system,system-ui,sans-serif;background:#f5f2ec;color:#2c2a26;padding:24px;max-width:1240px;margin:0 auto}" +
  "h1{font-size:20px}h2{margin:28px 0 10px;font-size:16px}h2 small{color:#8a857c;font-weight:500}" +
  "p{color:#57534b;font-size:13px;max-width:880px}" +
  ".grid{display:flex;flex-wrap:wrap;gap:14px}" +
  ".card{background:#fffdf9;border:1px solid #e4ddd0;border-radius:10px;padding:10px}" +
  ".cap{font-size:12px;margin-bottom:6px}" +
  ".card svg{border:1px solid #eee7db;border-radius:8px}" +
  ".lg{display:grid;grid-template-columns:1fr 1fr;gap:1px 12px;font-size:11px;color:#57534b;margin-top:6px;max-width:340px}" +
  ".lg i{display:inline-block;width:10px;height:3px;border-radius:2px;vertical-align:3px;margin-right:4px}" +
  ".lg small{color:#8a857c}" +
  "</style></head><body>" +
  "<h1>Tap Match — bot efor eğrileri</h1>" +
  "<p>6 arama botu aynı efor tanımıyla (ilk match'e dek geçilen search point) ama farklı arama " +
  "psikolojisiyle oynar: <b>yerel</b> son tap'ten halka, <b>merkezci</b> hep board merkezinden, " +
  "<b>okuyucu</b> sol üstten satır satır, <b>ışın</b> en yakın taşın ışınlarını takip eder, " +
  "<b>hafızalı</b> süpürdüğünü " + "6 hamle hatırlar (taş kalkınca satır/sütunu bayatlar), " +
  "<b>karışım</b> önce yerel halka sonra satır tarama. Her eğri KENDİ maksimumuna normalize — " +
  "şekiller karşılaştırılır, mutlak değerler lejantta (ort · maks).</p>";

// konsol özeti: bot × diff (ort eforun ortalaması), klasik / tam dolu ayrı
const sum = {};
for (const b of BOTS) {
  sum[b.id] = {};
  for (const grp of ["klasik", "tam"]) {
    sum[b.id][grp] = {};
    for (const d of DIFFS) sum[b.id][grp][d] = [];
  }
}

for (const size of sizes) {
  const pk = readPack(size);
  // efor paketleri özete girmez: etiketleri reçete şeridi, eğrileri şablona
  // uydurulmuş — klasik/tam ayrışma sinyalini kirletir
  const grp = size.startsWith("efor-") ? null : pk.full ? "tam" : "klasik";
  // özet: tüm leveller; grafik: seçki (ya da --level hedefi)
  for (const lv of pk.levels) {
    if (only && (size !== only[0] || lv.id !== +only[1])) continue;
    if (!grp) continue;
    for (const b of BOTS) {
      const ec = effortCurve(lv.pairs, pk.rows, pk.cols, null, b.id);
      if (ec && DIFFS.includes(lv.diff)) sum[b.id][grp][lv.diff].push(ec.effortMean);
    }
  }
  const chosen = only
    ? (size === only[0] ? pk.levels.filter((l) => l.id === +only[1]) : [])
    : pickLevels(pk);
  if (!chosen.length) continue;
  html += "<h2>" + size + " <small>" + pk.cols + "×" + pk.rows +
    (pk.full ? " · tam dolu" : "") + "</small></h2><div class=\"grid\">" +
    chosen.map((lv) => levelCard(pk, lv)).filter(Boolean).join("") + "</div>";
}
html += "</body></html>";
fs.writeFileSync(path.join(__dirname, "..", "bot_curves.html"), html);

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const mono = (ms) => (ms[0] < ms[1] && ms[1] < ms[2] && ms[2] <= ms[3] + 0.02 ? "✓" : "✗");
for (const grp of ["klasik", "tam"]) {
  console.log("\n" + grp.toUpperCase() + " paketler — bot × diff (ort eforun ort.)");
  console.log("bot        " + DIFFS.map((d) => d.padEnd(10)).join("") + "sıra");
  for (const b of BOTS) {
    const ms = DIFFS.map((d) => mean(sum[b.id][grp][d]));
    console.log(b.name.padEnd(11) + ms.map((m) => m.toFixed(1).padEnd(10)).join("") +
      (ms.some(isNaN) ? "?" : mono(ms)));
  }
}
console.log("\nbot_curves.html yazıldı — " + ((Date.now() - t0) / 1000).toFixed(1) + " sn");
