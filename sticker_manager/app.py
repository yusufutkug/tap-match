#!/usr/bin/env python3
"""Sticker kutuphane yoneticisi.

Calistir:  python3 sticker_manager/app.py   ->  http://localhost:8055

Yapi:
  sticker_manager/
    library/<kategori>/*.png   kutuphane (tek dogruluk kaynagi)
    trash/                     silinenler (geri alinabilir)
    catalog.json               etiketler: id, src, cat, color (birincil), name

API:
  GET  /api/catalog
  POST /api/import  {"path": "/abs/klasor", "category": "flowers"}
  POST /api/delete  {"ids": ["flowers/x.png", ...]}
"""
import json, os, re, shutil, threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

import numpy as np
from PIL import Image

BASE = os.path.dirname(os.path.abspath(__file__))
LIB = os.path.join(BASE, 'library')
TRASH = os.path.join(BASE, 'trash')
CATALOG = os.path.join(BASE, 'catalog.json')
SID_SEQ = os.path.join(BASE, 'sid_seq.json')  # kova basina siradaki numara
PORT = 8055
LOCK = threading.Lock()

HUE_BUCKETS = [
    ('red',     -15,  14),
    ('orange',   14,  42),
    ('yellow',   42,  70),
    ('green',    70, 165),
    ('teal',    165, 200),
    ('blue',    200, 258),
    ('purple',  258, 315),
    ('pink',    315, 345),
]


def primary_color(path):
    """PNG -> tek birincil renk kovasi (algi odakli kurallar).

    Piksel sayimina ek dort algi kurali (2026-09 kalibrasyonu):
    - cam mavisi: soluk/acik maviler (cam kap tinti) gri sayilir, yoksa
      kavanoz/caydanlik gibi cam objeler icerigine ragmen blue kazaniyordu.
    - grafit: koyu-soluk maviler (fume plastik/metal govde) gri sayilir
      (kahve ogutucusunun govdesi blue kazandiriyordu).
    - krem/bej: dusuk doygun acik sarimsilar white sayilir (elma kesiti
      yellow kazaniyordu).
    - haki/olive: koyu-mat sarilar green sayilir (haki canta yellow cikiyordu).
    - pink/purple siniri 290 -> 315: patlican/yaban mersini moru pink
      cikiyordu. Acik pastel magenta yine pink, koyu gul kurusu purple.
    """
    a = np.asarray(Image.open(path).convert('RGBA'), dtype=np.float32) / 255.0
    rgb = a[..., :3][a[..., 3] > 0.8]
    if len(rgb) == 0:
        return 'gray'
    mx = rgb.max(1); mn = rgb.min(1); d = np.maximum(mx - mn, 1e-6)
    v = mx
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    r, g, b = rgb[:, 0], rgb[:, 1], rgb[:, 2]
    h = np.zeros(len(rgb), np.float32)
    m = mx == r; h[m] = (60 * ((g - b) / d) % 360)[m]
    m = mx == g; h[m] = (60 * ((b - r) / d) + 120)[m]
    m = mx == b; h[m] = (60 * ((r - g) / d) + 240)[m]

    n = len(rgb)
    shares = {}
    dark = v < 0.22
    achroma = (~dark) & (s < 0.20)
    chroma = (~dark) & (~achroma)
    # algida notr olan soluk tonlar
    glass = chroma & (h >= 185) & (h < 255) & (s < 0.35) & (v > 0.55)
    graphite = chroma & (h >= 200) & (h < 258) & (s < 0.45) & (v <= 0.65)
    cream = chroma & (h >= 20) & (h < 70) & (s < 0.38) & (v > 0.75)
    shares['black'] = dark.sum() / n
    shares['white'] = ((achroma & (v > 0.82)) | cream).sum() / n
    shares['gray'] = ((achroma & (v <= 0.82)) | glass | graphite).sum() / n
    chroma = chroma & ~glass & ~graphite & ~cream
    brown = chroma & (h >= 5) & (h < 50) & (v < 0.62)
    shares['brown'] = brown.sum() / n
    olive = chroma & ~brown & (h >= 50) & (h < 75) & (v < 0.72)
    rest = chroma & ~brown & ~olive
    hh = np.where(h >= 345, h - 360, h)
    pastel_red = rest & (hh >= -15) & (hh < 14) & (s < 0.52) & (v > 0.72)
    pastel_magenta = rest & (hh >= 290) & (hh < 315) & (s < 0.45) & (v > 0.80)
    dark_pink = rest & (hh >= 315) & (hh < 345) & (v < 0.60)
    for name, lo, hi in HUE_BUCKETS:
        m = rest & (hh >= lo) & (hh < hi)
        if name == 'red':
            m = m & ~pastel_red
        elif name == 'purple':
            m = (m & ~pastel_magenta) | dark_pink
        elif name == 'pink':
            m = (m & ~dark_pink) | pastel_magenta
        sh = m.sum() / n
        if name == 'green':
            sh += olive.sum() / n
        elif name == 'pink':
            sh += pastel_red.sum() / n
        shares[name] = shares.get(name, 0) + sh
    # birincil renk: en buyuk pay; notr (beyaz/gri/siyah) ancak canli renk
    # belirgin degilse kazanir (canli >= %25 ya da notrun %80'i ise canli alir)
    vivid = {k: v_ for k, v_ in shares.items() if k not in ('white', 'gray', 'black')}
    neutral = {k: shares[k] for k in ('white', 'gray', 'black')}
    top_v = max(vivid, key=vivid.get) if vivid else None
    top_n = max(neutral, key=neutral.get)
    if top_v and (vivid[top_v] >= 0.25 or vivid[top_v] >= neutral[top_n] * 0.8):
        return top_v
    return top_n


def load_seq():
    if os.path.exists(SID_SEQ):
        return json.load(open(SID_SEQ))
    return {}


def mint_sid(cat_name, color, seq):
    """Kalici sticker kimligi uret: kategori_renk_sira (orn. fruits_red_03).

    Numaralar kova (kategori+renk) icinde artar ve ASLA geri donmez:
    silinen sticker'in numarasi emekli olur, yeniden kullanilmaz. Boylece
    eski level dosyalari hicbir zaman yanlis sticker'a cozulmez.
    """
    key = f'{cat_name}_{color}'
    n = seq.get(key, 1)
    seq[key] = n + 1
    return f'{key}_{n:02d}'


def assign_sids():
    """sid'i olmayan kayitlara kimlik basar (dosya adina gore sirali,
    tekrar calistirmak guvenli). Donus: basilan sid listesi."""
    cat = load_catalog()
    seq = load_seq()
    minted = []
    for e in sorted((x for x in cat if not x.get('sid')), key=lambda x: x['id']):
        e['sid'] = mint_sid(e['cat'], e['color'], seq)
        minted.append(f"{e['sid']}  <-  {e['id']}")
    sids = [e['sid'] for e in cat if e.get('sid')]
    if len(sids) != len(set(sids)):
        raise RuntimeError('sid cakismasi tespit edildi, kayit yapilmadi')
    json.dump(seq, open(SID_SEQ, 'w'), ensure_ascii=False, indent=1, sort_keys=True)
    save_catalog(cat)
    return minted


def load_catalog():
    if os.path.exists(CATALOG):
        return json.load(open(CATALOG))
    return []


def save_catalog(cat):
    json.dump(cat, open(CATALOG, 'w'), ensure_ascii=False, indent=1)


def do_import(src_path, category):
    src_path = os.path.expanduser(src_path.strip())
    if not os.path.isdir(src_path):
        return {'error': f'klasor bulunamadi: {src_path}'}
    category = re.sub(r'[^a-zA-Z0-9_-]', '_', category.strip()) or os.path.basename(src_path)
    dest = os.path.join(LIB, category)
    os.makedirs(dest, exist_ok=True)
    cat = load_catalog()
    seq = load_seq()
    known = {e['id'] for e in cat}
    added = 0
    for fn in sorted(os.listdir(src_path)):
        if not fn.lower().endswith('.png'):
            continue
        clean = re.sub(r'\s+', '_', fn)
        rid = f'{category}/{clean}'
        if rid in known:
            continue
        fp = os.path.join(dest, clean)
        shutil.copy2(os.path.join(src_path, fn), fp)
        color = primary_color(fp)
        cat.append({
            'id': rid, 'src': rid, 'cat': category,
            'color': color,
            'name': os.path.splitext(clean)[0],
            'sid': mint_sid(category, color, seq),
        })
        added += 1
    json.dump(seq, open(SID_SEQ, 'w'), ensure_ascii=False, indent=1, sort_keys=True)
    save_catalog(cat)
    return {'ok': True, 'added': added, 'category': category}


def _sync_sid(e, seq):
    """Renk degistiyse sid'i yeni kovadan yeniden basar (sid renk tasir;
    eski numara emekli olur). sid yoksa dokunmaz."""
    if e.get('sid') and not e['sid'].startswith(f"{e['cat']}_{e['color']}_"):
        e['sid'] = mint_sid(e['cat'], e['color'], seq)


def do_set_color(rid, color):
    """Elle renk atama. color='auto' -> yeniden hesapla ve kilidi ac;
    diger degerler -> ata ve kilitle (recolor asla ezmez).
    Renk degisirse sid de yeni kovadan yeniden basilir."""
    valid = {n for n, _, _ in HUE_BUCKETS} | {'brown', 'white', 'gray', 'black'}
    cat = load_catalog()
    for e in cat:
        if e['id'] != rid:
            continue
        if color == 'auto':
            e['color'] = primary_color(os.path.join(LIB, e['src']))
            e.pop('color_locked', None)
        elif color in valid:
            e['color'] = color
            e['color_locked'] = True
        else:
            return {'error': f'gecersiz renk: {color}'}
        seq = load_seq()
        _sync_sid(e, seq)
        json.dump(seq, open(SID_SEQ, 'w'), ensure_ascii=False, indent=1, sort_keys=True)
        save_catalog(cat)
        return {'ok': True, 'id': rid, 'color': e['color'],
                'sid': e.get('sid'), 'locked': bool(e.get('color_locked'))}
    return {'error': f'id bulunamadi: {rid}'}


def recolor_all():
    """Kilitli olmayan tum kayitlarin rengini yeniden hesaplar.
    Rengi degisenlerin sid'i de yeni kovadan yeniden basilir."""
    cat = load_catalog()
    seq = load_seq()
    changed = []
    for e in cat:
        if e.get('color_locked'):
            continue
        p = os.path.join(LIB, e['src'])
        if not os.path.exists(p):
            continue
        c = primary_color(p)
        if c != e['color']:
            changed.append({'id': e['id'], 'old': e['color'], 'new': c})
            e['color'] = c
            _sync_sid(e, seq)
    json.dump(seq, open(SID_SEQ, 'w'), ensure_ascii=False, indent=1, sort_keys=True)
    save_catalog(cat)
    return changed


def do_delete(ids):
    os.makedirs(TRASH, exist_ok=True)
    cat = load_catalog()
    idset = set(ids)
    kept, moved = [], 0
    for e in cat:
        if e['id'] in idset:
            src = os.path.join(LIB, e['src'])
            if os.path.exists(src):
                shutil.move(src, os.path.join(TRASH, e['src'].replace('/', '__')))
            moved += 1
        else:
            kept.append(e)
    save_catalog(kept)
    return {'ok': True, 'deleted': moved, 'remaining': len(kept)}


class Handler(SimpleHTTPRequestHandler):
    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/' or self.path.startswith('/index'):
            self.path = '/index.html'
            return super().do_GET()
        if self.path == '/api/catalog':
            with LOCK:
                return self._json(load_catalog())
        return super().do_GET()

    def do_POST(self):
        ln = int(self.headers.get('Content-Length', 0))
        try:
            payload = json.loads(self.rfile.read(ln) or b'{}')
        except json.JSONDecodeError:
            return self._json({'error': 'gecersiz json'}, 400)
        with LOCK:
            if self.path == '/api/import':
                return self._json(do_import(payload.get('path', ''),
                                            payload.get('category', '')))
            if self.path == '/api/delete':
                return self._json(do_delete(payload.get('ids', [])))
            if self.path == '/api/set_color':
                return self._json(do_set_color(payload.get('id', ''),
                                               payload.get('color', '')))
            if self.path == '/api/recolor':
                return self._json({'ok': True, 'changed': recolor_all()})
        return self._json({'error': 'bilinmeyen endpoint'}, 404)

    def translate_path(self, path):
        # statik dosyalar: index.html BASE'den, gorseller library'den
        path = path.split('?', 1)[0]
        if path == '/index.html':
            return os.path.join(BASE, 'index.html')
        return os.path.join(LIB, path.lstrip('/'))

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    import sys
    os.makedirs(LIB, exist_ok=True)
    if '--recolor' in sys.argv:
        # kilitliler haric tum renkleri yeniden hesapla ve degisimleri bas
        for ch in recolor_all():
            print(f"{ch['id']}: {ch['old']} -> {ch['new']}")
        sys.exit(0)
    if '--sids' in sys.argv:
        # sid'i olmayan kayitlara kimlik bas (tekrar calistirmak guvenli)
        minted = assign_sids()
        for m in minted:
            print(m)
        print(f'{len(minted)} sid basildi')
        sys.exit(0)
    print(f'Sticker Manager -> http://localhost:{PORT}')
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
