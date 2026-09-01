# Tap Match

Tap tap match'in kardeşi — girdi taş değil **boş hücre**. Hücreye tap:
hücrenin 4 yönde gördüğü en yakın taşlar (≤4) hesaplanır, aralarında çift
varsa taşlar hücreye kayar, çarpışıp kırılır.

Kurallar (v1):

- **match:** gören taşlar arasında tam çift(ler) → çift(ler) hücreye gelir,
  patlar. İki çift aynı anda görüyorsa ikisi birden (çifte patlama / combo).
  Eşi olmayan gören taşlar yerinde kalır.
- **miss:** gören taş var ama çift yok → taşlar hücreye gelir, kırılmadan
  geri döner + hata animasyonu. Yan ürün: hatalı tap bile bilgi verir
  (o hücrenin neyi gördüğünü fiziksel gösterir).
- **blank/dolu:** hücre hiç taş görmüyorsa nabız; dolu hücrede taş sallanır.
- Her sticker levelda tam iki taşta (çift başına benzersiz) → yanlış-ama-geçerli
  hamle yoktur.

Eşleşme geometrisi (eski mekanikten fark):

- Hizalı çift → koridordaki herhangi bir boş hücre (iki tarafa da görüş açık).
- Hizasız çift → dikdörtgenin **iki köşe hücresi** (L eşleşmesi — eski oyunda
  bu çift hiç eşleşemezdi).

Yapısal garanti: taş kalkması görüşü yalnız açar, boş hücreyi yalnız artırır
(monotonluk) → açılan eşleşme bir daha kapanmaz; çözülebilir level her
sırayla biter. Yapısal deadlock iki türlü: **hizalı+bitişik (span-1) çift**
(arasında hücre yok, köşesi yok — tap tap match'in tersi: orada giriş
hamlesiydi, burada yasak) ve **karşılıklı kilit döngüleri** (ör. çapraz
kilit: iki hizasız çift birbirinin köşe hücrelerine oturur). Genel doğrulama
`js/flow.js`'teki AND/OR dalga analizidir: ∞ dalga = deadlock.

## Akış tasarımı — düğüm→zincir + U-kavisi

Bir çiftin açılması AND/OR yapısındadır: hizalı çift koridorundaki taşların
HEPSİNİN kalkmasını ister; hizasız çift iki köşe seçeneğinden BİRİNİN
temizlenmesini. `js/flow.js` bunun üstüne iki ölçüm kurar:

- `analyzeFlow` — AND/OR dalga fixpoint'i (dalga-0 = girişler, dar dalgalar =
  düğümler), sıkı kilit-açma grafı, giriş/zincir/düğüm sınıflandırması.
- `pairsCurve` — FIFO oyuncu simülasyonu: yapısal eğri (açık/kalan; start,
  waist, dip) + **arama eforu** eğrisi (boş hücre / match veren hücre — düğümde
  doğru hücreyi bulma maliyeti; effortPeak belde zirve yapmalı) + oynanan
  hamlenin türü (koridor = kolay görülür, köşe = iki cross'un kesişimi,
  bilişsel yük; cornerShare belde köşe payı).

`js/generator.js` yapı-önce tersten inşa (ttm generateChunkLevel uyarlaması):

- **giriş** (entryN): kısa hizalı çiftler, dalga-0 — U'nun sol kolu. Girişler
  ölü içerik olmasın diye üç kademede bağlanır: **fitil** (bir taşı kapı
  dibinin rezerve bölgesine oturur → kapı ancak fitil tapıyla açılır, anında
  görünür etki; o kapı dibi artık dalga-0 sayılmaz), **bağlı** (bir taşı
  hizasız bir halkanın rezerve edilmemiş köşe bölgesine oturur → girişin
  kalkması o köşe seçeneğini gerçekten açar), **serbest** (bağlantı yoksa eski
  yayılmış yerleşim — kalan nadir etkisiz girişleri seçim aşaması cezalandırır).
- **kapı** (gateN, dev boardlarda 2): derin zincir, dibi dalga-0, halkaları
  köşe/hizalı karışımı (gateCornerP) → bel, kapı hattının aranmasıdır.
- **kilitli** (lockedN): derin zincirler; dipleri **doğuştan kilitli** doğar —
  dip, açılma bölgesinde hâlihazırda kapı (ya da önceki kilitli → geçişli
  olarak yine kapı) taşı olan çift olarak seçilir. Kapı söküldükçe kilitliler
  kademeli açılır (hasat); U'nun sağ kolu boşalan boarddan kendiliğinden gelir.

Kilit ilkelleri: hizalı ebeveyne koridor taşı; hizasız ebeveyne iki köşeyi
öldüren çocuk (köşe hücresi ya da bacak hücresi; bir köşe zaten ölüyse tek
taş yeter). Her çift yerleştiği anda açık doğar (openNow disiplini, dipler
hariç); sonra konan çocuk kilitler — sonra konan önce oynanır.

Döngü emniyeti: her zincir bitince halkalarının **ileri-yönlü bir açılma
yolu rezerve edilir** (hizalıda koridor, hizasızda güvenli tek köşe bölgesi).
Sonradan konan taş önceki zincirin bölgesine oturamaz → bağımlılık grafı
inşa gereği ileri-yönlü, zincirler arası döngü (deadlock) imkânsız. (İlk
mimari kapının mustFill hücrelerini kovalamasıydı; kilit bölgesi kısıtları
yüzünden büyük boardlarda ölçeklenmedi — bu yüzden ters çevrildi: kapı önce,
dipler mevcut taşların gölgesine.)

İnşa sezgiseldir, garanti doğrulamadan gelir: her aday pairsCurve +
analyzeFlow süzgecinden geçer (çözülebilirlik, dalga-0 = tasarım, dip ≤
dipMax; seçim: küçük dip + yüksek cornerShare + düşük **inertShare** —
hiçbir çiftin açılma seçeneğinde bloker olmayan dalga-0 çifti "etkisiz
giriş"tir, ölü içerik sayılır ve ağır ceza yer; hedef ≤ %25, pratikte
fitil+bağlı yerleşim sayesinde %2-11). Deterministiktir (seed → level).

Amaze GO karşılaştırma analizinden (2500 level, %96'sı U-şekilli) gelen
opsiyonel kadranlar:

- `waistPosTarget` — bel konumu hedefi (AG belde t≈0.4-0.5; bizim üretim
  doğal olarak erken bel verir, hedefle ortaya çekilir).
- `waistOpenMax` — belde MUTLAK açık çift tavanı (AG zorluğu oransal dip
  yerine "belde 2-3 açık seçenek" ile ölçekliyor; start/waist birlikte düşer).

## 100 Levellik Funnel

Paket, AG'nin `LevelSequence` + Warmup/Relief desenini izleyen testere-dişi
bir funnel'dır: **10 levellik döngü × 10 dekat**. Döngü etiketi:

```
easy easy medium medium hard easy easy medium veryhard easy
```

Zirvelerden (hard, very hard) hemen sonra easy rahatlama gelir. Boyutlar
(kolon×satır) dekada göre tablodan gelir: dekat 1 `6x8/7x10/8x12/9x12`,
dekat 2 `6x9/8x10/9x12/8x14`, dekat 3-10 `7x9/8x10/9x12/8x14`; dekat ≥ 7'de
very hard `9x15`e büyür; **49 ve 99 dev 12×18 çift kapı** zirveleridir.

Zorluk iki eksende korele: **etiket bandı** (lockedN, derinlik, cornerP,
bel kısıtları etikete göre) + **global rampa** (`t = (dekat-1)/9` ile aynı
etiket dekat ilerledikçe sertleşir). Her level için karşılaştırılabilir
**zorluk skoru** hesaplanır (çift sayısı, derinlik, efor zirvesi, köşe payı,
belde nefes alanı); üretim sonrası **onarım geçidi** sıralamayı bozan
hard/very hard levelleri farklı seedlerle yeniden üretir — sonuç: her
dekatta easy < medium < hard ≤ very hard ve dört etiketin de dekatlar
boyunca yükselen trendi. Üretemeyen reçete kademeli gevşetilir (deneme
tavanı ↑ → bel kısıtı ↑ → kilitli ↓ → derinlik ↓), funnel'da delik kalmaz.

## Oyun kabuğu: telefon çerçevesi + can + kamera

Oyun, sayfa ortasındaki telefon çerçevesinde oynanır. HUD'da geçen süre
(yukarı sayar, win/fail'de durur) ve **3 can** vardır: `miss` (taşlar gelip
eşleşemeden dönen hatalı tap) bir can yakar; boş `blank` tap yakmaz. Canlar
bitince level başarısız olur — Tekrar Dene canları ve süreyi sıfırlar.

Board, Amaze GO'nun kamera modeliyle gezilir (`js/camera.js`): açılışta
board viewporta sığdırılır (fit = minZoom, AG FullBoardView), pinch/tekerlek
ile fit'in ~2.2 katına dek zoom (AG ZoomRange 2.1→4.0 oranı), tek
parmak/fare sürüklemesiyle pan (board sınırına clamp, bırakınca damping'li
atalet — AG SwipeInertia). Tap ile drag, 8px eşiğiyle ayrılır (AG
tapThreshold): eşik aşılırsa gesture'ın click'i hücreye ulaşmaz.

## Level Lab

`lab.html` — üreticiyi tarayıcıda kurcalama sayfası: parametre paneli
(boyut, giriş/kilitli/kapı, derinlik, köşe olasılıkları, bel hedefleri, seed),
hazır presetler, aday üretimi; aday başına eğri grafiği (açık/kalan + arama
eforu + Amaze GO ortalama referansı + bel işareti), rol renkli board önizleme
(giriş yeşil / kapı kırmızı / kilitli mavi), metrik rozetleri. **▶ Oyna**
levelı `localStorage` üzerinden `index.html?lab=1`'e gönderir ve oyun otomatik
başlar; **JSON kopyala** çıktıyı panoya alır.

## Dosyalar

| Dosya | Rol |
|---|---|
| `js/board.js` | çekirdek: `visibleTilesFrom` (4 yön taraması), `resolveTap` (occupied/blank/miss/match), `availableTapCells`, `isAdjacentCollinear` |
| `js/flow.js` | ölçüm: `analyzeFlow` (AND/OR dalga + deadlock tespiti), `pairsCurve` (U-eğri + arama eforu + köşe payı) |
| `js/generator.js` | yapı-önce üretici: `buildGeometry` (giriş/kapı/kilitli), `generateLevel` (doğrula+seç), `generateCandidates` |
| `levels.js` | elle yazılmış 6 öğretici level (oyun listesinde değil; test/lab tarafında) |
| `levels_gen.js` | üretilmiş funnel (100 level, E-E-M-M-H-E-E-M-VH-E × 10 dekat; `tools/gen_levels.js` yazar — elle düzenleme) |
| `js/game.js` + `index.html` + `style.css` | oyun sayfası: telefon çerçevesi + HUD (süre, 3 can), hücreye tap, uçuş/çarpışma/geri dönme animasyonları, ipucu, combo sayacı; level grid'de zorluk şeridi |
| `js/camera.js` | board kamerası: pinch zoom + swipe pan + clamp + atalet, tap/drag ayrımı (AG'nin LeanTouch kamera modelinin web karşılığı) |
| `lab.html` + `js/lab.js` | level lab: parametreyle üret, eğrileri gör, tek tıkla oyna |
| `tools/test_board.js` | çekirdek duman testleri + level doğrulama |
| `tools/test_flow.js` | ölçüm katmanı testleri (dalga, deadlock, eğri) + level raporu |
| `tools/test_generator.js` | üretici duman testi + konfigürasyon istatistikleri |
| `tools/gen_levels.js` | funnel üretimi (döngü/boyut/rampa tabloları + onarım geçidi → `levels_gen.js`) |

## Çalıştırma

- Oyun: `index.html`'i tarayıcıda aç (build gerekmez, `file://` çalışır).
- Lab: `lab.html`'i aç — üret, incele, oyna.
- Test: `node tools/test_board.js` · `node tools/test_flow.js` · `node tools/test_generator.js`
- Paket yenile: `node tools/gen_levels.js`

## Level formatı

```json
{ "id": 1, "name": "Koridor", "rows": 4, "cols": 4, "pairs": [[[0,0],[0,3]]], "seed": 11 }
```

`pairs` FIFO kanonik oynanış sırasındadır; geçmeyen hücreler boş. Sticker
ataması kozmetik (çift indeksi → emoji, seed'e bağlı). Üretilmiş levellarda
`meta` alanı ölçümleri taşır (depth, dip, fill, cornerShare).
