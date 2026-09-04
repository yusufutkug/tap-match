"use strict";

// Şekil maskeleri — level silüetleri.
//
// Maske, boardun hangi hücrelerinin taş barındırabileceğini söyler:
// mask[r][c] = true → hücre şekil İÇİ (taş konabilir), false → şekil DIŞI
// (kalıcı boş; görüş hattı üstünden geçer, tap edilebilir kalır — koridor
// bir şekil boşluğundan geçebilir). Üreticide reserved semantiğine birebir
// oturur (bkz. js/generator.js buildGeometry mask notu).
//
// İki görsel kanal: taş kütlesi şekli taşır (pozitif silüet), şekil dışı
// alan ise tap edilecek negatif boşluğu büyütür — yönlendirme buradan gelir.
//
// Şekiller matematiksel tanımlıdır (bitmap değil) → her board boyutuna
// kayıpsız ölçeklenir. Koordinat: hücre merkezi u,v ∈ [-1,1] (v aşağı artar).

var TM_SHAPES = (function () {
  const DEFS = {
    dolu: { name: "Dolu", fn: null }, // maske yok: tam dikdörtgen (mevcut davranış)
    kalp: {
      name: "Kalp",
      // klasik kalp implicit'i: (x²+y²-1)³ - x²y³ ≤ 0 (y yukarı);
      // ölçek boyu dolduracak ve üst çentik grid'de okunacak şekilde ayarlı
      fn: (u, v) => {
        const x = u * 1.2, y = -v * 1.15 + 0.15;
        const a = x * x + y * y - 1;
        return a * a * a - x * x * y * y * y <= 0;
      },
    },
    elmas: { name: "Elmas", fn: (u, v) => Math.abs(u) + Math.abs(v) <= 1.15 },
    halka: {
      name: "Halka",
      fn: (u, v) => { const d = Math.hypot(u, v); return d >= 0.45 && d <= 1.1; },
    },
    ok: {
      name: "Ok",
      // yukarı ok: tepe ucu üstte açılan başlık + gövde şaftı.
      // Negatif alan (iki üst köşe) gözü uca — ilk tap bölgesine — çeker.
      fn: (u, v) => (v <= 0.05
        ? Math.abs(u) <= (v + 1) * 1.05
        : Math.abs(u) <= 0.36),
    },
    kumsaati: {
      name: "Kum saati",
      // üst+alt üçgen, belde dar boğaz (0.14: bel hücresiz kalmasın)
      fn: (u, v) => Math.abs(u) <= Math.max(0.14, Math.abs(v) * 1.05),
    },
    carpi: {
      name: "Çarpı",
      fn: (u, v) => Math.abs(u - v) <= 0.5 || Math.abs(u + v) <= 0.5,
    },
    cerceve: {
      name: "Çerçeve",
      // kenar bandı; ortadaki boş oda tap arenası olur
      fn: (u, v) => Math.max(Math.abs(u), Math.abs(v)) >= 0.42,
    },

    // ── Ada maskeleri: şekil, boş kanallarla ayrılmış bloblardan oluşur ──
    // Akış tasarımı için: her blob kendi içinde yerel akış verir, bloblar
    // arası çiftler (köprüler) düğüm anlarıdır; kanallar köprü koridorları.
    papyon: {
      name: "Papyon",
      // merkeze incelen iki kanat + ortada dikey boş kanal (iki ada)
      fn: (u, v) => Math.abs(u) >= 0.24 && Math.abs(v) <= Math.abs(u) * 0.85 + 0.22,
    },
    yonca: {
      name: "Yonca",
      // 4 çeyrek blob + artı biçimli boş kanal; dış köşeler pahlı
      fn: (u, v) => Math.abs(u) > 0.17 && Math.abs(v) > 0.13 &&
        Math.abs(u) + Math.abs(v) <= 1.6,
    },
    takimada: {
      name: "Takımada",
      // köşegen boyunca üç blok ada. İmplicit tanım dar gridlerde adaları
      // birleştiriyordu; hücre uzayında bant hesabı araya HER boyutta en az
      // bir boş satır koyar (ada garantisi).
      fn: (u, v, r, c, rows, cols) => {
        const gap = 1;
        const h = Math.floor((rows - 2 * gap) / 3); // bant yüksekliği
        const extra = rows - 2 * gap - 3 * h;       // artan satırlar orta banda
        const bands = [[0, h], [h + gap, 2 * h + gap + extra], [rows - h, rows]];
        const w = Math.ceil(cols * 0.55);
        for (let k = 0; k < 3; k++) {
          if (r < bands[k][0] || r >= bands[k][1]) continue;
          const c0 = Math.round(((cols - w) * k) / 2);
          return c >= c0 && c < c0 + w;
        }
        return false;
      },
    },
    bantlar: {
      name: "Bantlar",
      // üç yatay bant, aralarında boş şeritler — en çıplak ada düzeni
      fn: (u, v) => Math.abs(v) <= 0.2 || Math.abs(v) >= 0.55,
    },
  };

  const ORDER = ["dolu", "kalp", "elmas", "halka", "ok", "kumsaati", "carpi", "cerceve",
    "papyon", "yonca", "takimada", "bantlar"];

  // ── Özel kalıplar (kalip.html editörü yazar) ──
  // localStorage "tm_custom_shapes": { id: { name, bmp: ["0101…", …] } }.
  // bmp, referans gridde elle çizilmiş bitmap'tir; maskFor bunu hedef boyuta
  // ÇOĞUNLUK örneklemesiyle ölçekler (formülle aynı sözleşme: her boyuta
  // kayıpsız uyum). Node'da localStorage yok → CUSTOM boş kalır.
  let CUSTOM = {};
  function reloadCustom() {
    CUSTOM = {};
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const raw = window.localStorage.getItem("tm_custom_shapes");
        if (raw) CUSTOM = JSON.parse(raw) || {};
      }
    } catch (e) { /* bozuk kayıt: boş devam */ }
  }
  reloadCustom();

  function customIds() { return Object.keys(CUSTOM); }
  function saveCustom(id, name, bmp) {
    CUSTOM[id] = { name, bmp };
    localStorage.setItem("tm_custom_shapes", JSON.stringify(CUSTOM));
  }
  function deleteCustom(id) {
    delete CUSTOM[id];
    localStorage.setItem("tm_custom_shapes", JSON.stringify(CUSTOM));
  }
  function defOf(id) { return DEFS[id] || CUSTOM[id] || null; }
  function nameOf(id) { const d = defOf(id); return d ? d.name : id; }
  function customBmp(id) { return CUSTOM[id] ? CUSTOM[id].bmp : null; }

  // bitmap → hedef boyut: her hedef hücre, bitmap'te kapladığı dikdörtgenin
  // çoğunluğunu alır (en-yakın örneklemeden pürüzsüz küçülür)
  function sampleBitmap(bmp, rows, cols) {
    const B = bmp.length, W = bmp[0].length;
    const m = [];
    let area = 0;
    for (let r = 0; r < rows; r++) {
      const row = [];
      const r0 = Math.floor((r * B) / rows), r1 = Math.max(r0 + 1, Math.floor(((r + 1) * B) / rows));
      for (let c = 0; c < cols; c++) {
        const c0 = Math.floor((c * W) / cols), c1 = Math.max(c0 + 1, Math.floor(((c + 1) * W) / cols));
        let on = 0, tot = 0;
        for (let br = r0; br < r1; br++) {
          for (let bc = c0; bc < c1; bc++) { tot++; if (bmp[br][bc] === "1") on++; }
        }
        const b = on * 2 >= tot && on > 0;
        row.push(b);
        if (b) area++;
      }
      m.push(row);
    }
    return { m, area };
  }

  // id + boyut → maske (2B bool) | null (dolu/tanımsız/dejenere: maske yok).
  function maskFor(id, rows, cols) {
    const def = defOf(id);
    if (!def) return null;
    if (def.bmp) {
      const { m, area } = sampleBitmap(def.bmp, rows, cols);
      return area >= 8 ? m : null;
    }
    if (!def.fn) return null;
    const m = [];
    let area = 0;
    for (let r = 0; r < rows; r++) {
      const row = [];
      const v = ((r + 0.5) / rows) * 2 - 1;
      for (let c = 0; c < cols; c++) {
        const u = ((c + 0.5) / cols) * 2 - 1;
        const on = !!def.fn(u, v, r, c, rows, cols);
        row.push(on);
        if (on) area++;
      }
      m.push(row);
    }
    return area >= 8 ? m : null; // dejenere maske: şekilsiz devam
  }

  // JSON taşıma: satır başına "0101…" dizgisi (kompakt, okunur).
  function encode(mask) {
    return mask.map((row) => row.map((b) => (b ? "1" : "0")).join(""));
  }
  function decode(lines) {
    if (!Array.isArray(lines)) return null;
    return lines.map((s) => Array.from(s, (ch) => ch === "1"));
  }

  function areaOf(mask) {
    let n = 0;
    for (const row of mask) for (const b of row) if (b) n++;
    return n;
  }

  return {
    DEFS, ORDER, maskFor, encode, decode, areaOf,
    customIds, saveCustom, deleteCustom, reloadCustom, nameOf, sampleBitmap,
    customBmp,
  };
})();

if (typeof module !== "undefined") module.exports = { TM_SHAPES };
