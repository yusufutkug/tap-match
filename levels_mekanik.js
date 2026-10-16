"use strict";

// Mekanik levelleri — elle yazılmış, DIŞ MOTOR FORMATINDA (export_levels ile
// aynı şema; js/board.js levelFromExternal oyun açılışında iç modele çevirir):
//   width/height, cells (index 0 SOL ALT; 0 dot, n≥1 çift kimliği),
//   stickers[n-1], TileGenerators: [{ Cell, Direction, Tiles }]
//   Direction: 0 yukarı · 1 aşağı · 2 sol · 3 sağ (ekran yönü)
//   Tiles: üretim sırasında çift kimlikleri (1 tabanlı); generator hücresi
//   cells'te 0 yazılır, TileGenerators onu ezer.
// Kural: generator önü başlangıçta DOLU olmalı (ilk üretim öndeki taş
// eşleşince). tools/test_board.js her levelı doğrular (yerleşim + çözüm).

var TM_MECH_LEVELS = [
  {
    id: 1, name: "Üretici",
    // Üstteki generator aşağı bakar; önündeki 1 kalkınca 2, 3, 4 sırayla
    // gelir. 5 çifti generator kırılınca açılır.
    width: 5, height: 4,
    cells: [
      4, 0, 3, 0, 0,
      0, 0, 0, 0, 0,
      1, 0, 1, 0, 2,
      5, 0, 0, 0, 5,
    ],
    stickers: [
      "fruits_red_01", "fruits_yellow_01", "fruits_orange_06",
      "fruits_green_01", "fruits_purple_01",
    ],
    TileGenerators: [{ Cell: 17, Direction: 1, Tiles: [2, 3, 4] }],
  },
  {
    id: 2, name: "İki üretici",
    // Soldaki sağa bakar (2, 3), sağdaki yukarı bakar (6); 6'nın eşi 1'in
    // arkasında kaldığından önce 1 kalkmalı — sıra yine serbest.
    width: 6, height: 6,
    cells: [
      4, 0, 0, 0, 0, 4,
      0, 0, 0, 3, 0, 0,
      0, 2, 0, 0, 0, 0,
      0, 0, 0, 5, 0, 5,
      0, 1, 0, 0, 0, 1,
      0, 0, 0, 0, 0, 6,
    ],
    stickers: [
      "fruits_red_01", "fruits_yellow_01", "fruits_orange_06",
      "fruits_green_01", "fruits_purple_01", "fruits_blue_01",
    ],
    TileGenerators: [
      { Cell: 24, Direction: 3, Tiles: [2, 3] },
      { Cell: 17, Direction: 0, Tiles: [6] },
    ],
  },
];

if (typeof module !== "undefined") module.exports = { TM_MECH_LEVELS };
