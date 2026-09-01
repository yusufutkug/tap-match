"use strict";

// Tap Match sticker temaları.
//
// Her tema:
//   name       – seçicide görünen ad
//   faces      – pairId'ye eşlenecek HTML parçaları. En büyük paket 64 çift
//                (12×18) → her temada en az 64 benzersiz yüz olmalı, yoksa
//                aynı sticker iki farklı çifte düşer ve oyuncuyu yanıltır.
//   faceScale  – taş yazı boyutu (BASE_CELL çarpanı; SVG yüzler CSS ile
//                boyutlandığı için onlarda etkisiz)
//   boardClass – board'a eklenen sınıf; tema bazlı taş görünümü CSS'te

const TM_THEMES = (function () {
  // 68 emoji (38 hayvan + 26 yiyecek + 4 ek)
  const emojiFaces = [..."🐶🐱🐭🐹🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🐔🐧🐦🐤🦆🦉🐺🐗🐴🦄🐝🦋🐢🐍🐙🦀🐬🦈🦓🦒🐘🦚🦜🐞🐌🦔🐳🍎🍐🍊🍋🍌🍉🍇🍓🍒🍑🥝🥑🥕🌽🍄🧀🍕🍔🍩🍪🍭🍫🍍🥥🍅🍆"];

  // Mahjong: Unicode taş glifleri (U+1F000 bloğu) — sayılar, daireler,
  // bambular, rüzgarlar, ejderler, çiçekler, mevsimler. 🀄 (kırmızı ejder)
  // çoğu platformda emoji olarak renkli basıldığı için sette yok.
  // 41 glif 64 çifte yetmez → gerçek setlerdeki gibi ikinci geçiş kırmızı
  // varyant olarak eklenir (82 yüz). \uFE0E metin sunumunu zorlar ki
  // CSS color uygulanabilsin.
  const MJ = [..."🀇🀈🀉🀊🀋🀌🀍🀎🀏🀙🀚🀛🀜🀝🀞🀟🀠🀡🀐🀑🀒🀓🀔🀕🀖🀗🀘🀀🀁🀂🀃🀅🀆🀢🀣🀤🀥🀦🀧🀨🀩"];
  const mahjongFaces = [
    ...MJ.map((g) => '<span class="mj">' + g + "\uFE0E</span>"),
    ...MJ.map((g) => '<span class="mj mj-red">' + g + "\uFE0E</span>"),
  ];

  // Kübik/sade şekiller: düz renkli inline SVG. 10 şekil × 7 renk = 70 yüz.
  const SHAPE_PATHS = {
    circle: '<circle cx="12" cy="12" r="8.5"/>',
    square: '<rect x="4.5" y="4.5" width="15" height="15" rx="2.5"/>',
    diamond: '<path d="M12 2.5l8.5 9.5-8.5 9.5-8.5-9.5z"/>',
    triangle: '<path d="M12 4l9.5 16h-19z"/>',
    star: '<path d="M12 2l2.9 6.6 7.1.7-5.4 4.8 1.6 7-6.2-3.7-6.2 3.7 1.6-7L2 9.3l7.1-.7z"/>',
    hexagon: '<path d="M12 2.8l8 4.6v9.2l-8 4.6-8-4.6V7.4z"/>',
    plus: '<path d="M9 3.5h6V9h5.5v6H15v5.5H9V15H3.5V9H9z"/>',
    ring: '<path fill-rule="evenodd" d="M12 3.5a8.5 8.5 0 100 17 8.5 8.5 0 000-17zm0 5a3.5 3.5 0 110 7 3.5 3.5 0 010-7z"/>',
    drop: '<path d="M12 2.5c4.2 5 6.5 8.3 6.5 11.5a6.5 6.5 0 11-13 0c0-3.2 2.3-6.5 6.5-11.5z"/>',
    pentagon: '<path d="M12 2.5l9.3 6.8-3.6 11H6.3l-3.6-11z"/>',
  };
  // birbirinden net ayrışan 7 renk
  const SHAPE_COLORS = ["#e05a4e", "#f0a132", "#4caf7d", "#3f8fd2", "#8e6bc1", "#2fb1a9", "#5f6b7a"];
  const shapeFaces = [];
  for (const d of Object.values(SHAPE_PATHS)) {
    for (const c of SHAPE_COLORS) {
      shapeFaces.push('<svg class="shape" viewBox="0 0 24 24" fill="' + c + '">' + d + "</svg>");
    }
  }

  // Mücevher: iki tonlu SVG — taş rengi + aynı path'in içeride küçültülüp
  // sola-yukarı kaydırılmış beyaz kopyası (parlama yüzeyi). Kopya %50
  // ölçekli olduğu için her şekilde taşmadan içeride kalır.
  // 9 kesim × 8 mücevher tonu = 72 yüz.
  const GEM_PATHS = {
    kite: '<path d="M8.5 3.5h7L19.5 9 12 20.5 4.5 9z"/>',
    octagon: '<path d="M8 3.5h8l4.5 4.5v8L16 20.5H8L3.5 16V8z"/>',
    oval: '<ellipse cx="12" cy="12" rx="7" ry="9"/>',
    marquise: '<path d="M12 2.5c3.6 3 5.5 6.4 5.5 9.5s-1.9 6.5-5.5 9.5c-3.6-3-5.5-6.4-5.5-9.5s1.9-6.5 5.5-9.5z"/>',
    heart: '<path d="M12 20.5C7.2 16.4 3.5 13 3.5 9.4 3.5 6.5 5.6 4.5 8 4.5c1.6 0 3.1.9 4 2.3.9-1.4 2.4-2.3 4-2.3 2.4 0 4.5 2 4.5 4.9 0 3.6-3.7 7-8.5 11.1z"/>',
    shield: '<path d="M12 3l7 2.5v6.2c0 4.4-2.9 7.4-7 9.3-4.1-1.9-7-4.9-7-9.3V5.5z"/>',
    crystal: '<path d="M12 2.5l6.5 4.8v9.4L12 21.5l-6.5-4.8V7.3z"/>',
    round: '<circle cx="12" cy="12" r="8.5"/>',
    tear: '<path d="M12 2.5c4.2 5 6.5 8.3 6.5 11.5a6.5 6.5 0 11-13 0c0-3.2 2.3-6.5 6.5-11.5z"/>',
  };
  const GEM_COLORS = ["#d63b52", "#f2a33c", "#2fa866", "#3671d8", "#8f54c9", "#22b2b2", "#e56fa1", "#5c6672"];
  const gemFaces = [];
  for (const d of Object.values(GEM_PATHS)) {
    const glossy = d.replace("/>", ' transform="translate(11 9.5) scale(0.5) translate(-12 -12)" fill="#fff" opacity="0.34"/>');
    for (const c of GEM_COLORS) {
      gemFaces.push('<svg class="shape gem" viewBox="0 0 24 24" fill="' + c + '">' + d + glossy + "</svg>");
    }
  }

  // Bayraklar: ülke kodundan regional-indicator emoji üretilir. Kodlar,
  // neredeyse özdeş bayraklar (🇳🇱/🇱🇺, 🇮🇩/🇲🇨, 🇷🇴/🇹🇩 gibi) tek temsilciyle
  // kalacak biçimde seçildi — 67 yüz. Not: Windows'ta Chrome bayrak emojisi
  // basmaz, harf çifti gösterir (yine benzersizdir ama görsel değildir).
  const FLAG_CODES = (
    "TR DE FR GB IT ES PT NL BE CH AT SE NO DK FI IS IE GR PL CZ HU RO BG UA " +
    "US CA MX BR AR CL CO PE UY CU JM PA CR DO HT " +
    "JP KR CN IN PK ID TH VN PH MY SG AZ GE AM KZ UZ SA AE QA IL " +
    "AU NZ ZA EG MA NG KE GH"
  ).split(" ");
  const flagFaces = FLAG_CODES.map((cc) =>
    [...cc].map((ch) => String.fromCodePoint(0x1f1e6 + ch.charCodeAt(0) - 65)).join("")
  );

  return {
    emoji: { name: "Emoji", faces: emojiFaces, faceScale: 0.44, boardClass: "theme-emoji" },
    mahjong: { name: "Mahjong", faces: mahjongFaces, faceScale: 0.66, boardClass: "theme-mahjong" },
    shapes: { name: "Şekiller", faces: shapeFaces, faceScale: 0.44, boardClass: "theme-shapes" },
    gems: { name: "Mücevher", faces: gemFaces, faceScale: 0.44, boardClass: "theme-gems" },
    flags: { name: "Bayraklar", faces: flagFaces, faceScale: 0.5, boardClass: "theme-flags" },
  };
})();

const TM_THEME_ORDER = ["emoji", "mahjong", "shapes", "gems", "flags"];

if (typeof module !== "undefined") {
  module.exports = { TM_THEMES, TM_THEME_ORDER };
}
