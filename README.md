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
- `effortCurve` — **min-efor bot**: hamle-başına efor fonksiyonu (köşe/koridor,
  span, köşe kıtlığı, son tap'e uzaklık + adım-seviyesi arama/yem terimleri)
  ve her adımda en ucuz hamleyi oynayan açgözlü oyuncu (monotonluk sayesinde
  asla kilitlenmez). Kalibrasyon bulgusu (1500 etiketli level,
  `tools/report_effort.js`): zirve DOYAR ve etiketleri ayırmaz — ayıran,
  yükün süresidir: **effortMean** (eğri alanı; easy→vh 2.35→2.80) ve
  **effortHiShare** (efor ≥ eşik adım payı; 0.40→0.64). Lab grafiğinde mor
  eğri + eşik çizgisi olarak görünür.
- `boardSalience` — **görünürlük (salience) modeli**, karma modelin
  parametresiz alternatifi: search point (taş ışınının kesişime kadarki
  hücre-incidence'ları; koridor 2'şer, L'de köşe 2 + bacaklar 1'er — L'nin
  tarama yolu maliyete yapısal girer) ve match point (çifti kıran hücreler)
  sayılır; efor = toplam search / hamlenin match'i = beklenen deneme sayısı
  (sınırsız). Bulgular: ölçek board alanıyla büyür (6×8 ~38 ↔ 12×18 ~205,
  eşikler level-göreli tutulur), ham haliyle etiket ayrışması karma modelden
  zayıf; en zor hamleler hep tek-match-noktalı (efor = tüm havuz).
  `effortCurve(pairs, rows, cols, null, "salience")` ile bot bu modelde koşar.
- `boardSweep` — **tarama (sweep) modeli**, salience'ın yörüngeli hali: göz
  son tap'ten (ilkinde board merkezinden) halka halka süpürür (artan
  Manhattan, eşitlikte satır-major); hücre maliyeti = nitelikli incidence
  sayısı (salience ile aynı sayım — yem bölge yavaşlatır, görüşsüz hücre
  bedava). Match hücresinin eforu = varışa dek geçilen search point; bot
  İLK bulduğunu oynar (satisficing). Yerellik parametresiz geri gelir,
  ölçek alanla şişmez. Bulgu: klasik funnel'da ayrışma zayıf ama TAM DOLU
  paketlerde üç modelin en iyisi (örn. tam-12x18 easy→vh 10.1→17.0 monoton)
  — coğrafya/tarama zorluğunu ölçtüğü için. `effortCurve(..., "sweep")`;
  `tools/report_hard_moves.js` boyut başına en zor 10 hamleyi, önceki
  hamlenin boardu + tarama başlangıcıyla `hard_moves.html`'e yazar.
- **Bot ailesi** (`SEARCH_BOTS`, `botEfforts`) — aynı efor tanımı (geçilen
  search point), altı arama psikolojisi: **yerel** (sweep; son tap'ten halka),
  **merkezci** (her adım board merkezinden — yerellik kontrol botu),
  **okuyucu** (sol üstten satır satır — sistematik taban çizgisi; konum
  önyargısını açığa çıkarır), **ışın** (en yakın taşın ışınlarını takip eden
  taş-güdümlü oyuncu), **hafızalı** (süpürdüğünü `MEMORY_DECAY`=6 hamle
  hatırlar; taş kalkınca yalnız satır/sütunu bayatlar — görüş 4 yönlü
  olduğundan bu geçersizleme tamdır; öğütmeyi ölçer), **karışım** (önce
  yerel halka `max(2,(rows+cols)/6)`, sonra satır tarama). Hepsi
  deterministik, `effortCurve(..., <botId>)` ile koşar. Bulgu
  (`tools/report_bot_curves.js` özeti): KLASİK paketlerde yalnız okuyucu
  monoton ayrışır (39.7→48.0 — zorluk sistematik taramada görünür, yerellik
  maskeler); TAM DOLU paketlerde okuyucu hariç tüm yerel aile monoton
  (yerel 8.5→12.1, ışın 5.9→8.1) — iki paket türü iki farklı zorluk türü
  taşıyor.

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

Playbar'daki **Efor** çipi canlı efor göstergesini döndürür (tasarım/test
aracı; kapalı → Karma → Görünürlük → Tarama): match veren her boş hücrede o hamlenin
eforu rozet olarak durur (hesap botla birebir aynı — `js/flow.js`
`boardEfforts` / `boardSalience`), her tap sonrası son tap konumuna ve
boardun yeni durumuna göre yeniden hesaplanır. Mor halka botun seçeceği en
ucuz hamledir; rozetin tooltip'i hesabın dökümünü verir. Renk kademesi karma
modelde `EFFORT_HI_THR` eşiğine, salience'ta (ölçek boyuta bağlı olduğundan)
adımın en ucuz hamlesine görelidir (≥2× sarı, ≥4× kırmızı).

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
- `knots` — **tempo senaryosu** (boş = kapalı): düğümler arası her adım
  yılan-yerelliğiyle akar, t = i/(n+1) anlarında cepheden en uzak seçeneğe
  zıplanır. 0 = saf akış (doğal uzak sıçramalar da bastırılır). Yerel-oyuncu
  simülasyonuyla ölçülüp hedefe yakın aday seçilir.
- `cut` — **kesme hattı** ("dikey"/"yatay"): maske merkezinden geçen tam hat
  taşları oyunun AÇILIŞINDA temizlenir → şekil gözle görülür adalara bölünür
  (bölünme anı `splitT` ile ölçülür, geç/yok bölünme cezalı). Bölmeyen hat
  ±3 kaydırılarak aranır; hiçbiri bölmüyorsa üretim null.

**Yerellik ölçümü** (`js/flow.js` `localityStats`): FIFO yerine "son tap'ine
en yakın açık hücreyi oynayan" yerel-oyuncu simüle edilir. `jump` = en yakın
devamın uzaklığı (akış hissi), **düğüm** = jump ≥ eşik (yerel devam yok,
arama şart), **öğütme** = art arda uzak hamle dizisi (ödülsüz arama tekrarı),
kuyruk metrikleri = son %20 saçılmamalı (final yerel kapanış kümesi olmalı).
`generateFullLevel` her adayda bunları ölçer: öğütme ve saçılmış kuyruk her
modda cezalı — 6×8 çerçeve lv18 analizinde teşhis edilen "sona yığılan
zorunlu uzak çaprazlar" hastalığını aday seçiminde eler.

**Ada maskeleri** (`js/shapes.js`): papyon (2 ada), yonca (4), takımada (3,
hücre-uzayı bant tanımı — implicit tanım dar gridlerde birleşiyordu),
bantlar (3). Her boyutta ≥2 ada garantili (test altında). Ada içi akış +
adalar arası köprü çiftleri = akış/düğüm iskeletinin maske-doğal hali;
tek parça şekillerde aynı etki `cut` ile oyun içinde yaratılır.

Kadran→metrik doğrulaması test altında (`tools/test_generator.js` "kadran"
testleri): köşeP %70↔%99, span 2.4↔5.1, bel 1.3↔4.6, yılan yerelliği
4.1→2.8 (kalp 8×10, sabit seedler); tempo: düğüm kapalı→5.2, hedef0→1.6,
hedef4→3.4 (kalp 12×9).

**Tam dolu şekil paketleri** (`levels_shapes.js`, `tools/gen_shape_levels.js`
yazar): boyut başına 50 level × 10 boyut = 500 level; ana ekranda "Tam dolu
şekiller" bölümünde listelenir. Şekil havuzu 9 çeşit: 4 tek parça (kalp,
çarpı, çerçeve, halka) + 4 ada maskesi (papyon, yonca, takımada, bantlar) +
dolu; tek parça şekiller yer yer kesme hattıyla gelir. Reçete 10'luk
bantlarla sertleşir: saf akış (yılan, düğüm 0) → parçalanma tanışması (ilk
kesmeler, düğüm 1) → adalar (bölge, düğüm 2, bel 3) → git-gel (ada+kesme,
düğüm 3) → en zor (giriş 4, dar bel, düğüm 4). Üretimde bant düğüm rampası
1.0→4.0 monoton çıkar; kesmelerin ~%90'ı t≤0.5'te bölünür (test altında).
Etiket şeridi banda göre easy→veryhard. İlerleme/favori anahtarları
`tam-6x8:id` biçiminde (klasik paketlerle çakışmaz).

**Efor hedefli paketler** (`levels_efor.js`, `tools/gen_effort_levels.js`
yazar): boyut başına 20 tam dolu level × 5 boyutluk merdiven (6x8, 7x10,
8x12, 9x14, 10x15) = 100 level; ana ekranda "Efor hedefli" bölümü. Üretim
iki katmanlıdır: iç katman (`generateFullLevel`) yapısal kaliteyi, dış
katman EFOR EĞRİSİNİN ŞEKLİNİ ve YÜKSEKLİĞİNİ seçer — level başına 60
aday üretilir, her adayı yerel + ışın botları oynar. Aday hedefi (leader)
üç parça: (1) eğrilerin hedef şablona RMSE ortalaması; (2) ÖĞÜTME CEZASI —
art arda uzun mesafe match (kırılan tüm çiftlerin spanı ≥ uzun kenarın
yarısı) payı × 0.4: oyuncu bulgusu, üst üste uzun matchler akma/düğüm
hissine hizmet etmiyor (ilk nesil paketlerde bu pay %36-44'tü, cezayla
~%13'e iner); (3) EFOR TABANI — aday kendi havuzunun efor medyanının altına
düşemez, mutasyon da leveli ucuzlatamaz ("efor olarak daha üstlere").
Reçeteler de aynı yöne iter: cornerP/düğüm yüksek (zorluk köşe/kilitten),
spanBias düşük (uzun koridor üretimden az gelsin). Hafızalı + karışım
tutarlılık bandı: 0.35'ten fazla kaçan aday, bant içi aday varken
seçilmez (hiç yoksa en az kaçan son çaredir). Aşama B
en iyi adayı REHBERLİ MUTASYONLA şablona iter (büyük boardlarda rastgele
aday havuzu şablonu tutturamıyor): mutasyon = iki çiftin 4 hücresini yeniden
eşleme (repairing — tam doluluk yapıdan korunur, hizalı+bitişik yasak
yerleşim ucuz elenir, çözülebilirlik bot koşusunda elenir); %50 olasılıkla
ilk çift, sweep eğrisinin şablondan en çok saptığı adım çevresinde kırılan
çiftlerden seçilir (sapmayı yapan bölgeye nişan). Kabul = öncü skor
iyileşir VE bant kötüleşmez; bütçe board alanıyla ölçeklenir (8×alan,
150-2000). Şablonlar `js/flow.js CURVE_TEMPLATES`:
1-10 **bel** (ortada zirve, sonda rahatlama — tek parça şekil + düğüm/dar
bel reçetesi), 11-20 **dalga** (iki tepe — kesme hatlı şekil: iki ada = iki
keşif fazı). Kalibrasyon (leader = şekil + öğütme cezası; düz çizginin bel
şablonuna salt-şekil RMSE'si ≈ 0.45): mutasyon A→B ort. 0.33→0.19 (6x8) /
0.42→0.29 (10x15); efor ort merdiveni 12.2→21.9; öğütme payı %6-14.5;
tutarlılık bandı dışında level yok. `report_bot_curves.js` efor
paketlerinde hedef şablonu grafiğe kesikli çizgiyle koyar — uyum gözle
denetlenir.

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
| `js/flow.js` | ölçüm: `analyzeFlow` (AND/OR dalga + deadlock tespiti), `pairsCurve` (U-eğri + arama eforu + köşe payı), `localityStats` (yerel-oyuncu: sıçrama/düğüm/öğütme/bölünme), `boardEfforts` (anlık hamle eforları — oyun içi gösterge ile botun ortak hesabı), `effortCurve` (min-efor bot: hamle-başına efor modeli + zorluk profili), `CURVE_TEMPLATES`/`shapeScore` (efor eğrisi hedef şablonları + RMSE uyum skoru — efor hedefli üretimin ölçü tarafı) |
| `js/generator.js` | yapı-önce üretici: `buildGeometry` (giriş/kapı/kilitli), `generateLevel` (doğrula+seç), `generateCandidates`; `mask` opsiyonuyla şekilli üretim; `peelBuild` + `generateFullLevel` ile tam dolu (ileri soyma) üretim |
| `js/shapes.js` | şekil maskeleri: `maskFor` (id+boyut → maske), `encode`/`decode` (JSON taşıma); ada maskeleri (papyon/yonca/takımada/bantlar); bitmap kalıplar (`sampleBitmap` çoğunluk örneklemesi) + özel kalıp kaydı (localStorage) |
| `kalip.html` + `js/kalip.js` | kalıp editörü: formülsüz şekil tasarımı — 24×16 tuvalde boya (simetri kilitleri, PNG içe aktarma, hazır şablonlar), 10 boyutta canlı önizleme (ada/alan/kesme tanıları), test üretimi + oynama, localStorage'a kayıt (lab şekil satırı okur), DEFS kodu dışa aktarma |
| `levels.js` | elle yazılmış 6 öğretici level (oyun listesinde değil; test/lab tarafında) |
| `levels/<boyut>/` | kanonik level verisi: her level AYRI json (`001.json`...) + paket künyesi `pack.json` (şema: aşağıda "Level JSON formatı"). Funnel paketleri `levels/6x8/`..., tam dolu şekil paketleri `levels/tam-6x8/`... — üreticiler yazar, elle düzenleme |
| `levels_gen.js` + `levels_shapes.js` + `levels_efor.js` | aynı verinin toplu script-tag sarmalayıcıları (`TM_PACKS`, `TM_SHAPE_PACKS`, `TM_EFOR_PACKS`) — oyun `file://` ile açıldığında fetch çalışmadığı için `index.html` bunları yükler; içerik `levels/` ile birebir (`test_generator.js` doğrular) |
| `js/game.js` + `index.html` + `style.css` | oyun sayfası: boyut seçimi → level grid → oyun; telefon çerçevesi + HUD (süre, 3 can), noktalı ızgara sunumu (mat + boş hücre noktaları) + basılı-tut görüş önizlemesi, hücreye tap, uçuş/çarpışma/geri dönme animasyonları, ipucu, combo sayacı, canlı efor göstergesi (playbar "Efor" çipi); level grid'de zorluk şeridi |
| `js/camera.js` | board kamerası: pinch zoom + swipe pan + clamp + atalet, tap/drag ayrımı (AG'nin LeanTouch kamera modelinin web karşılığı) |
| `lab.html` + `js/lab.js` | level lab: parametreyle üret, eğrileri gör, tek tıkla oyna |
| `tools/test_board.js` | çekirdek duman testleri + level doğrulama |
| `tools/test_flow.js` | ölçüm katmanı testleri (dalga, deadlock, eğri) + level raporu |
| `tools/test_generator.js` | üretici duman testi + konfigürasyon istatistikleri |
| `tools/report_effort.js` | efor botu kalibrasyon raporu: tüm paketlerde `effortCurve`, diff etiketi × ort efor / eşik-üstü pay tabloları (`--salience` / `--sweep` alternatif modeller; `--levels <boyut>` tek paketin level dökümü) |
| `tools/report_hard_moves.js` | sweep botla (`--salience` ile oran modeli) boyut başına en zor 10 hamle (level başına ≤2), zor hamlenin boardu + önceki hamlenin boardu yan yana → `hard_moves.html` (üretilir, gitignore'da) |
| `tools/report_bot_curves.js` | bot ailesi grafikleri: paket başına her diff'ten ortadaki level, 6 botun normalize efor eğrisi tek grafikte (`--level 9x12:37` hedefli) → `bot_curves.html` + konsola bot × diff ayrışma özeti |
| `tools/gen_levels.js` | paket üretimi (boyut başına döngü/rampa + doluluk hedefli çift sayısı + çok geçişli onarım → `levels/<boyut>/` + `levels_gen.js`; `TM_SIZES=6x8 node tools/gen_levels.js` ile kuru koşu) |
| `tools/gen_shape_levels.js` | tam dolu şekil paketi üretimi (4 şekil × kadran bantları → `levels/tam-<boyut>/` + `levels_shapes.js`; `TM_SIZES=6x8` ile kuru koşu) |
| `tools/gen_effort_levels.js` | efor-hedefli paket üretimi: aday başına yerel+ışın botu oynar, efor eğrisi hedef şablona (bel/dalga) RMSE ile seçilir; Aşama B rehberli repairing mutasyonuyla şablona iter → `levels/efor-<boyut>/` + `levels_efor.js`; `TM_SIZES=6x8` ile kuru koşu |
| `tools/pack_io.js` | paket yazıcı/okuyucu: üretici çıktısını level başına json dosyalarına + `.js` sarmalayıcıya böler (`writePacks`), testler için geri okur (`readPack`) |

## Çalıştırma

- Oyun: `index.html`'i tarayıcıda aç (build gerekmez, `file://` çalışır).
- Lab: `lab.html`'i aç — üret, incele, oyna.
- Test: `node tools/test_board.js` · `node tools/test_flow.js` · `node tools/test_generator.js`
- Paket yenile: `node tools/gen_levels.js` · `node tools/gen_shape_levels.js` · `node tools/gen_effort_levels.js` (hepsi `levels/` altına level başına json + toplu `.js` sarmalayıcı yazar)

## Level JSON formatı

Kanonik veri `levels/` altında, paket başına bir klasör ve her level AYRI
dosya (şema `tapmatch-pack@1`):

```
levels/6x8/pack.json       {"format":"tapmatch-pack@1","size":"6x8","cols":6,"rows":8,"count":100}
levels/6x8/001.json        {"id":1,"diff":"easy","pairs":[[[3,5],[1,5]],[[2,2],[0,2]]]}
levels/6x8/002.json        ...
levels/tam-6x8/pack.json   {"format":"tapmatch-pack@1","size":"tam-6x8","cols":6,"rows":8,"full":true,"count":50}
levels/tam-6x8/001.json    ...
```

Level yalnızca oynanış için gerekeni taşır — üç alan:

- `id`: 1..count (dosya adı = 3 haneli id); ilerleme/favori anahtarı
  `"size:id"` bundan kurulur.
- `diff`: `easy | medium | hard | veryhard` — level kartındaki zorluk
  rengi (level adı gösterilmez).
- `pairs`: FIFO kanonik oynanış sırasında `[[r,c],[r,c]]` çiftleri;
  geçmeyen hücreler boş.

Levelda OLMAYAN her şey türetilir: `rows`/`cols` `pack.json`'dan gelir,
emoji karışım tohumu `"size:id"`den hash'lenir (kozmetik; `js/game.js`
açılışta hydrate eder), şekil silüeti %100 dolu paketlerde `pairs`'ten
çıkar. Üretim metrikleri (score, fill, knots...) hiç saklanmaz — kalite
kontrolleri üretim anında yapılır (`gen_levels.js` onarım geçitleri,
`gen_shape_levels.js` sözleşme kontrolleri).

`levels_gen.js` / `levels_shapes.js` aynı verinin toplu script-tag
sarmalayıcılarıdır (`TM_PACKS`, `TM_SHAPE_PACKS`) — oyun `file://` ile
açıldığında `fetch` çalışmadığı için `index.html` bunları yükler; içerik
`levels/` ağacıyla birebir aynıdır ve `test_generator.js` bunu doğrular.

Elle yazılmış öğretici levellar (`levels.js`) eski geniş biçimi korur
(`name`, `rows`, `cols`, `seed` level üstünde):

```json
{ "id": 1, "name": "Koridor", "rows": 4, "cols": 4, "pairs": [[[0,0],[0,3]]], "seed": 11 }
```
