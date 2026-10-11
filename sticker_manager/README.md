# Sticker Manager — Kütüphane Notları

Tap match oyunu için sticker kütüphanesi + yönetim aracı. Bu klasör kendi içinde
taşınabilir: tüm yollar `app.py`'nin bulunduğu klasöre görelidir.

## Aracı çalıştırma

```bash
python3 app.py    # -> http://localhost:8055
```

Gereksinim: Python 3 + `numpy` + `Pillow` (renk tespiti için).
Bu makinede paketler Framework Python'da kurulu; `python3` bulamazsa:
`/Library/Frameworks/Python.framework/Versions/3.12/bin/python3 app.py`

## Klasör yapısı

```
sticker_manager/
  app.py          sunucu (port 8055)
  index.html      arayüz
  library/<kategori>/*.png   kütüphane — tek doğruluk kaynağı
  trash/          silinenler (cat__dosya.png olarak, geri alınabilir)
  catalog.json    etiketler
```

`catalog.json` kayıt şeması: `{"id": "kategori/dosya.png", "src": aynı,
"cat": kategori, "color": birincil renk, "name": dosya adı,
"sid": kalıcı sticker kimliği}`.
Elle düzeltilen kayıtlarda ek olarak `"color_locked": true` bulunur —
kilitli renkler otomatik yeniden hesaplamada asla ezilmez.

## sid — kalıcı sticker kimliği (level'ların kullanacağı ID)

Format: `kategori_renk_sıra`, örn. `fruits_red_01`, `gems_blue_03`.
Level dosyaları sticker'lara SADECE sid ile referans verir (dosya adı değil).

Sid'ler artık level'lara bağlı: funnel (`../export_levels/`) ve öğretici
(`../tutorial_levels/`) dosyaları `stickers` alanında sid taşır; oyun
haritayı `../stickers_map.js`'ten çözer (katalog değişince
`node ../tools/gen_sticker_map.js` ile yenile).

Kurallar:
- **Benzersiz ve kalıcı.** Numara kova (kategori+renk) içinde artar;
  `sid_seq.json` sayaç dosyası sayesinde silinen sticker'ın numarası emekli
  olur, asla yeniden kullanılmaz → eski level yanlış sticker'a çözülmez.
- **Renk sid'e gömülüdür ve sid'deki renk resmîdir.** Renk değişirse
  (elle atama ya da recolor) sid yeni kovadan yeniden basılır, eski sid
  emekli olur. Bu yüzden renkler kesinleşmeden sid'e level bağlama.
  (İlk 1286 sid 2026-09-25'te, renk kalibrasyonu sonrası basıldı.)
- Yeni import edilen sticker'lar otomatik sid alır.
- `python3 app.py --sids`: sid'i olmayan kayıtlara kimlik basar
  (tekrar çalıştırmak güvenli, mevcut sid'lere dokunmaz).
- Arayüzde gridde sticker'ın altında ve lightbox'ta sid görünür; arama
  sid ile de çalışır (örn. "gems_blue").

## API

- `GET /api/catalog` — tüm katalog.
- `POST /api/import` `{"path": "/abs/klasor", "category": "flowers"}` — klasördeki
  PNG'leri `library/<kategori>/`'ye kopyalar, boşlukları `_` yapar, birincil rengi
  otomatik hesaplar. Aynı id varsa atlar (tekrar import güvenli).
- `POST /api/delete` `{"ids": [...]}` — dosyaları `trash/`'e taşır, katalogdan düşer.
- `POST /api/set_color` `{"id": ..., "color": "red"}` — elle renk ata + kilitle.
  `"color": "auto"` gönderilirse yeniden hesaplar ve kilidi açar.
  Renk değiştiyse sid yeniden basılır ve yanıtta döner.
  Arayüzden: sticker'a çift tıkla → lightbox'taki renk çipine tıkla.
  Kilitli sticker'ın renk noktası gridde beyaz halkalı görünür.
- `POST /api/recolor` — kilitliler hariç tüm renkleri yeniden hesaplar,
  değişenleri döndürür. CLI eşdeğeri: `python3 app.py --recolor`.

## Renk tespiti (birincil renk kuralı)

Opak piksellerin HSV dağılımı; kovalara pay hesaplanır:
- Ton kovaları: red (−15..14, sarmal), orange (14–42), yellow (42–70),
  green (70–165), teal (165–200), blue (200–258), purple (258–315), pink (315–345).
- Nötrler: black (v<0.22), white (düşük doygunluk & v>0.82), gray (arası),
  brown (h 5–50 & v<0.62).
- Pastel kırmızı → pink: düşük doygunluk (s<0.52) + açık (v>0.72) kırmızılar pembe sayılır.
- **Birincil renk:** en büyük paylı canlı renk kazanır, ama ancak payı ≥ %25 ise
  ya da en büyük nötrün %80'ine ulaşıyorsa; yoksa nötr (white/gray/black) kazanır.
  (Örn. beyaz zambak → white, sarı frezya → yellow.)

2026-09 algı kalibrasyonu (%22'lik sınırda-karar taramasının bulguları):
- **Cam mavisi → gray:** h 185–255 & s<0.35 & v>0.55. Cam kap tinti obje rengi
  sayılmaz (yulaf kavanozu, cam fanus blue kazanıyordu → fanustaki gül artık red).
- **Grafit → gray:** h 200–258 & s<0.45 & v≤0.65. Füme plastik/metal gövde
  (kahve öğütücü, polis arabası) blue kazandırıyordu; turuncu traktör bile
  camları yüzünden blue çıkıyordu → artık orange.
- **Krem/bej → white:** h 20–70 & s<0.38 & v>0.75. Elma kesiti gibi krem iç
  yüzeyler yellow kazandırıyordu (kesik kırmızı elma → artık red).
- **Haki/olive → green:** h 50–75 & v<0.72. Haki bel çantası yellow çıkıyordu.
- **Pink/purple sınırı 290 → 315:** patlıcan ve yaban mersini moru pink
  çıkıyordu → artık purple. Açık pastel magenta (s<0.45 & v>0.8) yine pink;
  koyu gül kurusu (315–345 & v<0.6) purple'a sayılır.
- Tek-vaka regresyonlar algoritmayla değil elle kilitle çözülür (örn. lavanta-gri
  kafalı sarı mikrofon → yellow, kehribar çaylı demlik → orange kilitlendi).
- `renk_supheli.txt`: kazanan payı <%45 ya da rakibi 10 puan içinde olan 287
  sticker (en zayıftan sıralı). Çok renkli objeler doğal olarak listede; elle
  göz kontrolü için öncelik sırasıdır, "yanlış" listesi değildir.

## Kütüphane durumu (son temizlik sonrası)

**1286 sticker, 38 kategori.** (Eski konumda — `apk extractor/sticker_manager` —
yapılan 11 silme 2026-09-25'te buraya eşitlendi.) Sayılar:

toys 70 · clothes 54 · blocks 53 · sports 53 · cookie_words 51 · flowers 47 ·
countrylife 46 · bedroom 41 · numbers 40 · camping 39 · school 39 · desserts 37 ·
fantasy 37 · bags 36 · christmas 36 · under_sea 36 · casino 35 · cleaning_items 35 ·
cat_items 35 · music 34 · carnival 32 · circus 30 · vegitables 29 · gems 29 ·
shapes 27 · cafe 26 · cinema 26 · baby_items 25 · kitchen 25 · cat_words 25 ·
fairytale 25 · breakfast 23 · art_tools 22 · fruits 22 · vehicles 19 · icons 19 ·
animals 18 · cold_drink 10

Renk dağılımı (2026-09 algı kalibrasyonu sonrası): orange 247, red 218,
green 176, blue 165, yellow 135, pink 129, white 85, brown 45, gray 30,
purple 29, teal 21, black 6.
(Purple/teal/gray/black az — "tek renk" level tarifleri için tek başına yetmez.
cold_drink 10 sticker'la tek başına level dolduramaz, mutlaka karışıma girer.)

## Benzerlik kuralları (silme kararlarının temeli)

Kullanıcının koyduğu üç kural:
1. Renk olarak benzeyenler **şekil olarak** ayırt edilebilir olmalı.
2. Şekil olarak benzeyenler **renk olarak** ayırt edilebilir olmalı.
3. Şekil VE renk olarak benzeyenler **sadece adet** farkıyla kalabilir.

Benzerlik ölçümü: alpha'ya göre kırp → kareye tamamla → gri (128) zemine bindir →
24×24 RGB'ye küçült → RMS mesafesi. d < 0.19 riskli çift sayılır. Bu metrik oyun içi
küçük tile görünümünü taklit eder; üç temizlik turunda toplam 60 sticker silindi
(flowers 41 + genel 16 + yeni kategoriler 3), hepsi `trash/`'te.

Aynı metrik `similar.py` ile ön-hesaplanır → `similar_pairs.json`
(d < 0.23 tüm çiftler; 2026-09: 39816 çift, 4610'u riskli d < 0.19).
Level tarif motoru (`../tools/assign_stickers.js`) bu veriyi kullanır:
d < 0.19 aynı levelda ASLA; erken decade'lerde eşik 0.23'e sıkılır
(ayrışma rampası). Mono/tek-renk levellarda aynı-renk stickerlar metrikte
doğal yakın olduğundan eşik kademeli gevşer (0.22 → 0.19).
Katalog değişince yeniden koş: `python3 similar.py` (numpy + Pillow —
gerekirse Framework Python, bkz. yukarıda).

Ton komşuluğu dersi: kırmızı–turuncu aynı şekil üzerinde "farklı renk" SAYILMAZ
(turuncu muska ve turuncu yarış arabası bu yüzden silindi). Kırmızı–pembe,
mavi–siyah, mavi–yeşil, sarı–mercan aynı şekilde bile ayırt edilebilir sayıldı.

## Kategori öğrenimleri — karışma desenleri

Kontrollerde tekrar eden 6 desen çıktı; yeni sticker üretirken/eklerken bunlara dikkat:

1. **Aynı asset iki kategoriye kopyalanmış.** En sık hata. Temizlenenler: kova
   (toys↔cleaning_items), buğday (blocks↔countrylife), oyuncak ayı (baby_items↔toys),
   çizme (countrylife↔clothes), davul (christmas↔circus), bilet (circus↔cinema),
   inci (under_sea içi). Yeni import'ta önce diğer kategorilerde aynı asset var mı bak.

2. **Kategori içi ikizler.** Aynı objenin iki çizimi (iki nota, iki kulaklık, iki
   turuncu sandalye/kask/koni, iki pembe mikrofon, iki sarı gem). Kural: aynı obje
   ikinci kez ancak farklı renkte girebilir.

3. **gems ↔ shapes çakışması (hâlâ açık).** Kırmızı yıldız, sarı yıldız, kırmızı
   yuvarlak, mavi altıgen iki kategoride de var ve neredeyse aynı. Çözüm: bu iki
   kategoriyi aynı level tarifinde ASLA karıştırma; ya da birinden çakışan dörtlüyü sil.

4. **numbers: aynı renk + benzer glif.** 8–3, 6–8, 0–9, 5–9 çiftleri aynı renkteyse
   karışır. Silme yerine çözüm: benzer glif çiftlerine zıt renkler ata (planlı renk
   dağılımı).

5. **İnce uzun objeler ailesi (karışık levellar için uyarı).** Oklava–cetvel,
   kaşık–beyzbol sopası, çırpıcı–çekiç, biz–kalem gibi çiftler kategori İÇİ levelda
   sorun değil ama karışık tariflerde aynı anda çağrılmamalı.

6. **Pembe yuvarlak tatlılar ailesi.** desserts/cafe/breakfast kesişiminde pembe
   toplar (donut, makaron, dondurma topu vb.) birbirine yaklaşıyor; merkezdeki
   dondurma topu silindi ama karışık pembe-ağırlıklı tariflerde hâlâ dikkat.

Ayrıca: casino'da maça ♠ / sinek ♣ ikisi de siyah ve siluetleri yakın — klasik ikon
oldukları için tutuldu, istenirse biri renklendirilebilir. shapes içinde aynı renkte
daire–altıgen çiftleri küçük boyutta yaklaşıyor; aynı renkte tutma.

## Yeni kategoriler (fairytale, fantasy, cold_drink, vehicles, icons) — notlar

Tarama sonrası silinenler: turuncu muska (fairytale — kırmızısıyla ikizdi), turuncu
yarış arabası (vehicles — kırmızısıyla ikizdi), düz pembe parlak top (icons — pembe
yıldız parayla ve tatlılardaki pembe yuvarlaklarla ikizdi).

- **fantasy ejderha yumurtaları hub'dır.** Pullu yumurta dokusu küçük boyutta aynı
  renkteki her yuvarlak objeye benziyor (turuncu yumurta ↔ balon/yılbaşı topu,
  mavi yumurta ↔ mavi balon/top). Karışık tariflerde yumurtayla aynı renkte
  yuvarlak obje çağırma.
- **fairytale zehirli elma ↔ fruits kırmızı elma.** Aynı siluet, aynı renk; kurukafa
  yüzü tek fark. fairytale + fruits'u aynı levelda karıştırma.
- **vehicles = aynı model araba renk varyantları.** Kırmızı–pembe araba ve mavi–siyah
  polis arabası renkle ayırt edilebilir diye tutuldu; yeni araç eklerken renk paletini
  mevcutlardan uzak seç.
- **icons = booster/rozet seti, kendi içinde iyi tasarlanmış** (çekiç, roket, alev,
  şimşek, mıknatıs, yıldız para hep renk çiftli). Ama jenerik yuvarlak/parlak formlar
  shapes ve gems ile çarpışıyor (mavi yıldız para ↔ mavi düz daire, sarı yonca ↔
  sarı altıgen). icons'u shapes/gems ile aynı levelda kullanma; pembe yıldız para
  pembe-yuvarlak tatlılar ailesine de (makaron, deniz kabuğu, salyangoz, fiş,
  voleybol topu) yakın.
- **fairytale sarı ↔ mercan terlik** sınırda tutuldu; sarı-ağırlıklı levelda ikisini
  birden kullanma.

## Level tarifleri için pratik notlar

- Bir level paketinde en fazla 64 çift → tek kategori yetmezse renk/tema tarifiyle
  kategoriler birleştirilir; birleştirirken yukarıdaki 3, 5, 6. desenlere bak.
- "Tek renk" levellar için güvenli renkler: orange, red, blue, green, pink, yellow
  (hepsi 120+ sticker). white/brown sınırda, purple/teal/gray/black tek başına yetmez.
- Referans arşiv (silinmemiş ham Tap Tile çıkarımı, 1891 sticker + kendi tarayıcısı):
  `../taptile_stickers/` — bu klasör taşınırsa o yol geçersiz olur, arşiv ayrı durur.
