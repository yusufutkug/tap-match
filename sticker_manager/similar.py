#!/usr/bin/env python3
"""Sticker benzerlik ön-hesabı → similar_pairs.json

Temizlik turlarında kullanılan metrikle aynı (README "Benzerlik kuralları"):
alpha'ya göre kırp → kareye tamamla → gri (128) zemine bindir → 24×24 RGB'ye
küçült → RMS mesafesi (0..1). d < 0.19 riskli çift sayılır; level tarif
motoru (tools/assign_stickers.js) erken decade'lerde daha geniş eşik
kullandığı için d < 0.23 altındaki TÜM çiftler yazılır.

Çıktı: {"threshold": 0.30, "pairs": [["sid_a", "sid_b", 0.174], ...]}
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
THUMB = 24
CUTOFF = 0.23


def thumb(path):
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im)
    alpha = a[..., 3]
    ys, xs = np.nonzero(alpha > 8)
    if len(ys) == 0:
        return None
    im = im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    w, h = im.size
    side = max(w, h)
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sq.paste(im, ((side - w) // 2, (side - h) // 2))
    bg = Image.new("RGBA", (side, side), (128, 128, 128, 255))
    bg.alpha_composite(sq)
    small = bg.convert("RGB").resize((THUMB, THUMB), Image.LANCZOS)
    return np.asarray(small, dtype=np.float32) / 255.0


def main():
    catalog = json.loads((HERE / "catalog.json").read_text())
    sids, mats = [], []
    for rec in catalog:
        p = HERE / "library" / rec["src"]
        if not p.exists():
            print("eksik dosya:", rec["src"], file=sys.stderr)
            continue
        t = thumb(p)
        if t is None:
            continue
        sids.append(rec["sid"])
        mats.append(t.reshape(-1))
    X = np.stack(mats)  # (n, 1728)
    print(f"{len(sids)} sticker yüklendi, mesafe matrisi hesaplanıyor...")
    # RMS mesafe: sqrt(mean((a-b)^2)) — kare açılımıyla vektörize
    sq = (X * X).sum(axis=1)
    d2 = sq[:, None] + sq[None, :] - 2.0 * (X @ X.T)
    np.maximum(d2, 0.0, out=d2)
    D = np.sqrt(d2 / X.shape[1])
    iu = np.triu_indices(len(sids), k=1)
    close = D[iu] < CUTOFF
    pairs = [
        [sids[i], sids[j], round(float(D[i, j]), 4)]
        for i, j in zip(iu[0][close], iu[1][close])
    ]
    pairs.sort(key=lambda p: p[2])
    out = {"threshold": CUTOFF, "pairs": pairs}
    (HERE / "similar_pairs.json").write_text(json.dumps(out) + "\n")
    risky = sum(1 for p in pairs if p[2] < 0.19)
    print(f"similar_pairs.json yazıldı: {len(pairs)} çift (d<{CUTOFF}), "
          f"{risky} riskli (d<0.19)")


if __name__ == "__main__":
    main()
