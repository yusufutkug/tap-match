"use strict";

// Elle yazılmış mekanik-test levelları (öğretici açılış paketi; üretilmiş
// paket levels_gen.js'te). Yasaklar: hizalı+bitişik (span-1) çift ve
// karşılıklı kilit döngüleri (bkz. js/board.js baş yorumu).
// tools/test_board.js her levelı doğrular (yasak yerleşim + çözülebilirlik).

var TM_LEVELS = [
  {
    id: 1, name: "Koridor", rows: 4, cols: 4, seed: 11,
    // İki yatay çift — araya tap, taşlar gelir çarpışır.
    pairs: [
      [[0, 0], [0, 3]],
      [[3, 0], [3, 3]],
    ],
  },
  {
    id: 2, name: "Köşe", rows: 5, cols: 5, seed: 22,
    // L eşleşmesi: hizasız çiftler dikdörtgen köşesinde kesişir.
    pairs: [
      [[0, 0], [2, 2]],
      [[0, 4], [4, 4]],
      [[4, 0], [2, 1]],
    ],
  },
  {
    id: 3, name: "Halka", rows: 5, cols: 5, seed: 33,
    pairs: [
      [[0, 0], [0, 2]],
      [[0, 4], [2, 4]],
      [[4, 4], [4, 2]],
      [[4, 0], [2, 0]],
    ],
  },
  {
    id: 4, name: "Kilit", rows: 6, cols: 6, seed: 44,
    // P0'ın koridoru P1'in taşıyla kapalı — önce P1 kırılmalı.
    pairs: [
      [[2, 1], [2, 4]],
      [[2, 2], [4, 2]],
      [[0, 1], [4, 5]],
      [[0, 0], [5, 0]],
      [[5, 3], [3, 5]],
    ],
  },
  {
    id: 5, name: "Çapraz", rows: 6, cols: 6, seed: 55,
    pairs: [
      [[0, 0], [0, 5]],
      [[1, 1], [3, 3]],
      [[1, 4], [4, 1]],
      [[2, 0], [5, 2]],
      [[2, 5], [5, 5]],
      [[3, 0], [1, 2]],
      [[5, 3], [2, 3]],
    ],
  },
  {
    id: 6, name: "Kavşak", rows: 7, cols: 7, seed: 66,
    // (3,3) hücresi iki çifti birden görür → tek tap'te çifte patlama.
    // Ayrıca köşe-bağımlılığı zinciri: P8 → P6 → P7.
    pairs: [
      [[0, 0], [0, 6]],
      [[6, 0], [6, 6]],
      [[0, 3], [3, 0]],
      [[3, 6], [6, 3]],
      [[1, 1], [1, 5]],
      [[5, 1], [5, 5]],
      [[2, 2], [4, 4]],
      [[2, 4], [4, 5]],
      [[4, 0], [2, 6]],
    ],
  },
];

if (typeof module !== "undefined") module.exports = { TM_LEVELS };
