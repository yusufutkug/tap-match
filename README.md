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

## Paketler: boyut başına 100 levellik funnel

Oyuncu önce **boyutu** (10 paket: 6×8 … 12×18), sonra **leveli** seçer.
Her paket, AG'nin `LevelSequence` + Warmup/Relief desenini izleyen
testere-dişi bir funnel'dır: **10 levellik döngü × 10 dekat**. Döngü etiketi:

```
easy easy medium medium hard easy easy medium veryhard easy
```

Zirvelerden (hard, very hard) hemen sonra easy rahatlama gelir.

**Doluluk sözleşmesi:** her level en az %50 dolu (`fillMin`, etiket hedefi
%52-60) — çift sayısı sabit verilmez, doluluk hedefinden çözülür
(`lockedN ≈ (hedef çift − giriş − kapı·L) / L`). Köşe oranı önceki pakete
göre bilinçli düşük (cornerP 0.30-0.70 bandı; bel-köşe payı ~%58-68).

Boyut artık zorluk taşımadığı için zorluk tamamen **yapıdan** gelir:
**etiket bandı** (derinlik bandı, cornerP, giriş sayısı, bel kısıtları) +
**global rampa** (`t = (dekat-1)/9`). Very hard, hard'dan daha derin zincir
bandı (derinlik tavanı hard için 1 kısılır) ve daha az girişle ayrışır.
Her level için **zorluk skoru** hesaplanır (derinlik, efor zirvesi, köşe
payı, belde nefes alanı); üretim sonrası **çok geçişli onarım geçidi**
sıralamayı bozan levelleri farklı seedlerle yeniden üretir, gerekirse üst
etiketi banda indirir — sonuç: her pakette her dekatta easy < medium <
hard ≤ very hard ve very hard'ın dekatlar boyunca yükselen trendi.
Üretemeyen reçete kademeli gevşetilir, funnel'da delik kalmaz.

## Oyun kabuğu: telefon çerçevesi + can + kamera

Oyun, sayfa ortasındaki telefon çerçevesinde oynanır. HUD'da geçen süre
(yukarı sayar, win/fail'de durur) ve **3 can** vardır: `miss` (taşlar gelip
eşleşemeden dönen hatalı tap) bir can yakar; boş `blank` tap yakmaz. Canlar
bitince level başarısız olur — Tekrar Dene canları ve süreyi sıfırlar.

Sunum **noktalı ızgaradır**: hücre kutusu çizilmez; her hücrenin merkezinde
silik bir nokta durur ve taş noktanın üstünü kapatır → görünürde yalnız
**boş** hücreler noktalıdır. Tap hedefleri ve hiza kutu olmadan okunur,
board silik bir mat üstünde düzgün hizalı sticker'lar gibi görünür. Bunu
**basılı-tut görüş önizlemesi** tamamlar: parmak boş noktada ~160ms
beklerse hücrenin 4 yön görüşü çizilir — taşa çarpan ışın koyu noktalı,
boşa giden silik; gören taşlar noktaya doğru eğilir. Önizleme yeni bilgi
vermez (taşlar zaten açık), yalnız okumayı hızlandırır; parmak tap eşiğini
aşarsa (drag/pinch) ya da kalkarsa kapanır.

Board, Amaze GO'nun kamera modeliyle gezilir (`js/camera.js`): açılışta
board viewporta sığdırılır (fit = minZoom, AG FullBoardView), pinch/tekerlek
ile fit'in ~2.2 katına dek zoom (AG ZoomRange 2.1→4.0 oranı), tek
parmak/fare sürüklemesiyle pan (board sınırına clamp, bırakınca damping'li
atalet — AG SwipeInertia). Tap ile drag, 8px eşiğiyle ayrılır (AG
tapThreshold): eşik aşılırsa gesture'ın click'i hücreye ulaşmaz.

## Şekil maskeleri (prototip)

`js/shapes.js` — level silüetleri: taşlar yalnız şekil İÇİNE yerleşir
(kalp, elmas, halka, ok, kum saati, çarpı, çerçeve; matematiksel tanım →
her boyuta ölçeklenir). Şekil dışı hücreler üreticide baştan `reserved`
setine girer — semantik birebir uyar: taş konamaz, görüş hattı üstünden
geçer, tap edilebilir kalır (koridor şekil boşluğundan geçebilir; kapı dibi
koridoru şekil dışına düşerse fitil oraya oturmaz). `fill` maske alanına
oranlanır. Oyun sunumunda şekil dışı hücreler ayrıca işaretlenmez (soketler
tekdüze); silüeti taş kütlesinin kendisi çizer. Maske level JSON'unda satır
başına "0101…" dizgisiyle taşınır (`mask`), lab ▶ Oyna ve JSON kopyala
dahil. Lab'da şekil çipleriyle seçilir; üretilmiş paketler (levels_gen.js)
henüz maskesiz.

**Tam dolu mod** (`generateFullLevel` + lab'daki "Tam dolu" anahtarı):
şekil içi %100 taşla dolar, boşluk yalnız şekil dışıdır — level dıştan içe
soyularak biter. Klasik yapı-önce inşa burada çalışmaz (kalıcı koridor
rezervasyonu doluluğun tersi; tersten greedy doldurma da son hücrelerde
kilitleniyor — denendi). Bunun yerine oyun İLERİ simüle edilir (`peelBuild`):
tam dolu boarddan her adımda bir boş hücrenin O AN gördüğü iki taş "çift"
ilan edilip kaldırılır — her adım tanım gereği oynanabilir, kayıt sırası
geçerli çözümdür, monotonluk oyuncu sırasını serbest bırakır. Span-1 yasağı
kendiliğinden sağlanır (aynı hücreden görülen taşlar ya araları açık hizalı
ya dik yönlerden hizasızdır). Maske onarımı: maske boardu tamamen kaplıyorsa
merkez hücre oyulur (tek delik soymayı başlatır), alan tek sayıysa kenardan
bir hücre düşülür. Açılış doğal yönlendirmedir: t=0'da açık çift payı düşük
(~0.03-0.4), geçerli tap noktaları şeklin köşe/girinti çevresidir.

**Soyma akış kadranları** (hepsi opsiyonel; boş kadran rastgele davranışı
korur — lab'da "Tam dolu" açıkken görünen satır):

- `entryN` — açılış noktası sayısı. Şekil dışı boş bağlantılı bileşenler
  ("havuz": halkanın iç odası, kum saatinin yan kamaları…) bulunur; girişler
  havuzlara dağıtılır (çoksa her havuza ≥1, azsa temas/büyüklük öncelikli),
  havuz içinde en-uzak-nokta örneklemesiyle yayılır. İlk soymalar buradan.
- `frontMode` — soyulacak hücre disiplini: **yılan** (tek cephe, hep son
  soyulanın yakını), **cepheler** (giriş başına cephe, dönüşümlü), **bölge**
  (taşlar girişe yakınlığa göre dilimlenir, sırayla soyulur). `frontBias`
  0..1 sadakat: her adım 1-bias olasılıkla serbest — yumuşak geçiş.
- `waistOpen` — orta dilimde (t 0.30-0.75) hedef açık tap noktası sayısı:
  aday soymaların SONRASI açıklığı ölçülüp hedefe en yakını seçilir —
  U-eğrisinin beli filtreyle değil inşayla çizilir. Ayrıca aday skoruna
  hedef cezası olarak eklenir (inşa + seçim birlikte çeker).
- `cornerP` / `spanBias` — köşe(L)/koridor eşleme payı ve ışın mesafesi
  eğilimi. İkisi de hücre seçimini DE yönlendirir (yalnız duo filtrelemek
  etkisizdi: tür/mesafe arzı hücre konumundan gelir — ölçülüp düzeltildi).

Kadran→metrik doğrulaması test altında (`tools/test_generator.js` "kadran"
testleri): köşeP %70↔%99, span 2.4↔5.1, bel 1.3↔4.6, yılan yerelliği
4.1→2.8 (kalp 8×10, sabit seedler).

**Tam dolu şekil paketleri** (`levels_shapes.js`, `tools/gen_shape_levels.js`
yazar): boyut başına 50 level × 10 boyut = 500 level; ana ekranda "Tam dolu
şekiller" bölümünde listelenir. 4 şekil (kalp, çarpı, çerçeve, halka) döner;
akış reçetesi 10'luk bantlarla sertleşir: yılan/giriş-1 → cepheler/giriş-2 →
bölge/giriş-3+bel-3 → gevşek cepheler/uzun ışın → serbest/giriş-4+bel-2.
Etiket şeridi banda göre easy→veryhard. İlerleme/favori anahtarları
`tam-6x8:id` biçiminde (klasik paketlerle çakışmaz).

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
| `js/generator.js` | yapı-önce üretici: `buildGeometry` (giriş/kapı/kilitli), `generateLevel` (doğrula+seç), `generateCandidates`; `mask` opsiyonuyla şekilli üretim; `peelBuild` + `generateFullLevel` ile tam dolu (ileri soyma) üretim |
| `js/shapes.js` | şekil maskeleri: `maskFor` (id+boyut → maske), `encode`/`decode` (JSON taşıma) |
| `levels.js` | elle yazılmış 6 öğretici level (oyun listesinde değil; test/lab tarafında) |
| `levels_gen.js` | üretilmiş paketler (`TM_PACKS`: 10 boyut × 100 level; `tools/gen_levels.js` yazar — elle düzenleme) |
| `levels_shapes.js` | tam dolu şekil paketleri (`TM_SHAPE_PACKS`: 10 boyut × 50 level; `tools/gen_shape_levels.js` yazar — elle düzenleme) |
| `js/game.js` + `index.html` + `style.css` | oyun sayfası: boyut seçimi → level grid → oyun; telefon çerçevesi + HUD (süre, 3 can), noktalı ızgara sunumu (mat + boş hücre noktaları) + basılı-tut görüş önizlemesi, hücreye tap, uçuş/çarpışma/geri dönme animasyonları, ipucu, combo sayacı; level grid'de zorluk şeridi |
| `js/camera.js` | board kamerası: pinch zoom + swipe pan + clamp + atalet, tap/drag ayrımı (AG'nin LeanTouch kamera modelinin web karşılığı) |
| `lab.html` + `js/lab.js` | level lab: parametreyle üret, eğrileri gör, tek tıkla oyna |
| `tools/test_board.js` | çekirdek duman testleri + level doğrulama |
| `tools/test_flow.js` | ölçüm katmanı testleri (dalga, deadlock, eğri) + level raporu |
| `tools/test_generator.js` | üretici duman testi + konfigürasyon istatistikleri |
| `tools/gen_levels.js` | paket üretimi (boyut başına döngü/rampa + doluluk hedefli çift sayısı + çok geçişli onarım → `levels_gen.js`; `TM_SIZES=6x8 node tools/gen_levels.js` ile kuru koşu) |
| `tools/gen_shape_levels.js` | tam dolu şekil paketi üretimi (4 şekil × kadran bantları → `levels_shapes.js`; `TM_SIZES=6x8` ile kuru koşu) |

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
