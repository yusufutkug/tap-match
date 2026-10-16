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

## Kütüphane durumu (2026-10-16, ikiz temizliği sonrası)

**1259 sticker, 44 kategori.** Yeni paket kabulünün (aşağıda) ardından aynı
gün 30 ikiz silindi (`trash/2026-10-16_ikizler/`, her kayıtta `neden` alanı):
shapes 8 (aynı renkte daire–altıgen–sekizgen, üçgen–koni–damla, beşgen),
emoji_faces 3, monsters 3, hats 2, landmarks 2, bedroom 2, cleaning_items 2,
desserts 2, fruits/robots/world_cuisine/gems/animals 1'er. **`vegitables` →
`vegetables`** birleştirildi: 22 eski sid yalnız kategori adı değişerek
yeniden adlandırıldı (numaralar korundu, çakışma yok; eşleme
`trash/2026-10-16_ikizler/_vegitables_to_vegetables.json`). Oyun paketinde
bu 22 dosyanın adı değişti — `export_stickers/` yeniden kopyalanmalı.

toys 60 · cookie_words 51 · sports 47 · animals 46 · desserts 46 · flowers 45 ·
icons 40 · numbers 40 · school 39 · hats 36 · shapes 36 · cleaning_items 34 ·
fruits 34 · art_tools 32 · weather 32 · music 30 · countrylife 29 · monsters 29 ·
gems 28 · halloween 28 · vegetables 27 · bags 26 · clothes 26 · world_cuisine 26 ·
bedroom 25 · cat_words 25 · breakfast 24 · cold_drink 24 · fantasy 24 ·
under_sea 24 · kitchen 23 · space 23 · candy 22 · dinosaurs 22 · emoji_faces 22 ·
carnival 21 · cinema 21 · landmarks 21 · camping 19 · christmas 18 · robots 14 ·
baby_items 12 · circus 5 · cat_items 3

Renk: orange 222, red 209, yellow 164, green 157, pink 148, blue 142,
white 88, purple 62, teal 31, brown 19, gray 16, black 1.
Benzerlik: 35313 çift (d<0.23), 4582 riskli (d<0.19).

Bilerek tutulan sınır çiftler (farklı obje, aynı renk): mavi baklava–artı
(shapes), kızgın–endişeli yüz (emoji_faces), kep–balıkçı şapka (hats_green),
baret–balıkçı şapka (hats_yellow), baget–mısır sosisli, kalp–yuvarlak lolipop,
deniz kabuğu–salyangoz. emoji_faces doğası gereği tek siluet: karışık
tariflerde aynı renkten en fazla 1–2 yüz çağır.

### Önceki adım (2026-10-16 yeni sticker kabulü)

**1289 sticker, 45 kategori.** 2026-10-16'da oyuna alınan paket
(`../newstickers/`, dosya adı = sid) tek doğruluk kaynağı kabul edildi:
730 yeni sticker eklendi (dosya adı `library/<kat>/<sid>.png`, renk sid'den;
otomatik renk tespiti 730/730 sid'deki renkle aynı çıktı), 58 sticker daha
elendi (`trash/2026-10-16_elenen/`, en çok blocks 22 → kategori kapandı).
Yeni sid'ler emekli numaraları atlıyor; `sid_seq.json` kullanılan en büyük
numaranın bir üstüne çekildi.

12 yeni kategori: hats 38 · monsters 32 · weather 32 · halloween 28 ·
world_cuisine 27 · emoji_faces 25 · landmarks 23 · space 23 · candy 22 ·
dinosaurs 22 · robots 15 · **vegetables 5** (yeni yazım; eski `vegitables` 22
ayrı kategori olarak duruyor — tarif motorunda ikisini aynı tema say).

toys 60 · cookie_words 51 · desserts 48 · animals 47 · sports 47 · flowers 45 ·
shapes 45 · icons 40 · numbers 40 · school 39 · hats 38 · cleaning_items 36 ·
fruits 35 · art_tools 32 · monsters 32 · weather 32 · music 30 · countrylife 29 ·
gems 29 · halloween 28 · bedroom 27 · world_cuisine 27 · bags 26 · clothes 26 ·
cat_words 25 · emoji_faces 25 · breakfast 24 · cold_drink 24 · fantasy 24 ·
under_sea 24 · kitchen 23 · landmarks 23 · space 23 · candy 22 · dinosaurs 22 ·
vegitables 22 · carnival 21 · cinema 21 · camping 19 · christmas 18 · robots 15 ·
baby_items 12 · circus 5 · vegetables 5 · cat_items 3

Renk: orange 229, red 214, yellow 169, green 159, pink 152, blue 144,
white 89, purple 62, teal 33, brown 20, gray 16, black 2.
(Altı ana renk yine 120+ → mono tarifleri için güvenli. purple 62'ye çıktı,
hâlâ mono için az.)

Benzerlik: 38259 çift (d<0.23), 5232 riskli (d<0.19). Yeni kategorilerle
gelen çakışmalar: **hats+shapes 68**, numbers+weather 45, shapes+weather 44,
kitchen+shapes 51, monsters+shapes 36, candy+shapes 31 — shapes hub olmaya
devam ediyor. Kategori içi aynı-renk ikizler: shapes 57, hats 30,
emoji_faces 28, monsters 27, landmarks 19 (bkz. aşağıdaki "yeni kategori
notları"). Yeni 730 sticker `renk_supheli.txt`'ye alınmadı (liste yalnız
2026-09 taramasını kapsar).

### Önceki durum (2026-10-13 beğeni elemesi)

**617 sticker, 34 kategori.** 2026-10-13'te kullanıcı oyun paketini
(`../export_stickers/`) elden geçirip beğenmediklerini sildi; kalan 617 sid
`../new_stickers/` klasörüyle buraya eşitlendi (669 sticker
`trash/2026-10-13_begenilmeyen/`'e taşındı, liste `_silinen_katalog.json`;
ayrıca hepsi git geçmişinde). Tamamen boşalan kategoriler: **cafe, casino,
fairytale, vehicles** (klasörleri kaldırıldı; sid sayaçları `sid_seq.json`'da
duruyor, numaralar emekli).

cookie_words 51 · numbers 40 · toys 37 · desserts 29 · gems 29 · sports 28 ·
flowers 27 · shapes 27 · bags 26 · clothes 26 · cat_words 25 · under_sea 25 ·
vegitables 23 · blocks 22 · school 22 · fruits 21 · music 19 · christmas 18 ·
animals 16 · icons 15 · breakfast 14 · cleaning_items 14 · baby_items 12 ·
carnival 10 · countrylife 7 · cold_drink 6 · art_tools 5 · circus 5 · kitchen 5 ·
cat_items 4 · bedroom 3 · cinema 3 · camping 2 · fantasy 1

Renk dağılımı: orange 114, red 97, pink 91, green 87, blue 78, yellow 71,
white 34, purple 18, brown 11, teal 11, gray 5, black 0.
(Hiçbir renk artık 120+ değil — "güvenli mono renk" eşiği 120'den aşağı
çekilmeli ya da mono tarifleri yeniden düşünülmeli. d≥0.19 ile ayrık
seçilebilen en büyük aynı-renk set: orange 75, red 72, blue 67, green 62,
pink 50, yellow 44, white 29 — 24 çiftlik mono board'lar hâlâ dolar.)

Eleme öncesi sayılar (2026-09-25, 1286 sticker, 38 kategori): toys 70 ·
clothes 54 · blocks 53 · sports 53 · cookie_words 51 · flowers 47 · countrylife 46 ·
bedroom 41 · numbers 40 · camping 39 · school 39 · desserts 37 · fantasy 37 ·
bags 36 · christmas 36 · under_sea 36 · casino 35 · cleaning_items 35 ·
cat_items 35 · music 34 · carnival 32 · circus 30 · vegitables 29 · gems 29 ·
shapes 27 · cafe 26 · cinema 26 · baby_items 25 · kitchen 25 · cat_words 25 ·
fairytale 25 · breakfast 23 · art_tools 22 · fruits 22 · vehicles 19 · icons 19 ·
animals 18 · cold_drink 10.

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
(d < 0.23 tüm çiftler; 2026-09: 39816 çift, 4610'u riskli d < 0.19;
2026-10-13 eleme sonrası: 8670 çift, 1349 riskli — 259'u aynı kategori+renk,
bunun 181'i numbers/cookie_words glif çiftleri).
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
