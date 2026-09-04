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

  // id + boyut → maske (2B bool) | null (dolu/tanımsız: maske yok).
  function maskFor(id, rows, cols) {
    const def = DEFS[id];
    if (!def || !def.fn) return null;
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

  return { DEFS, ORDER, maskFor, encode, decode, areaOf };
})();

if (typeof module !== "undefined") module.exports = { TM_SHAPES };
