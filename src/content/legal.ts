/**
 * Uygulama içi yasal metinler — `docs/yasal-metinler.md`'nin aynısı.
 * Gizlilik Politikası v3.4'ten beri yayındaki web sayfasının özeti
 * (`LEGAL_URLS.privacy`); web sayfası değişirse bu da güncellenir.
 *
 * Metinleri burada değiştirme, kısaltma, yeniden yazma: kaynak md
 * dosyası. `test/legal.test.ts` md dosyası varsa ikisini birebir
 * karşılaştırıyor.
 *
 * Kalın yazı `**...**` olarak duruyor; `LegalText` bileşeni gösteriyor
 * (markdown paketi yok). Metin bölüm dizisi: paragraf ya da madde listesi.
 */

/** Ad, e-posta ve yürürlük tarihi tek yerden (web sayfasıyla aynı) */
export const LEGAL_CONTACT = {
  name: 'Çağrı Çelikkol',
  email: 'dinc.destekk@gmail.com',
  effectiveDate: '15 Ekim 2026',
} as const;

/**
 * Yayındaki tam metinler (v3.4). Uygulama içi Gizlilik Politikası bunun
 * özeti; ikisi çelişmesin. Sistem tarayıcısında açılır.
 */
export const LEGAL_URLS = {
  privacy: 'https://cagricelikkoll.github.io/dinc-legal/',
  accountDeletion: 'https://cagricelikkoll.github.io/dinc-legal/hesap-sil.html',
} as const;

const { name: NAME, email: EMAIL, effectiveDate: EFFECTIVE_DATE } = LEGAL_CONTACT;

export type LegalBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] };

export interface LegalDocument {
  title: string;
  blocks: LegalBlock[];
}

export type LegalDocId = 'privacy' | 'kvkk';

const p = (text: string): LegalBlock => ({ kind: 'paragraph', text });
const list = (...items: string[]): LegalBlock => ({ kind: 'list', items });

// ============================================================================
// METİN 1 — Gizlilik Politikası (özet; tam metin LEGAL_URLS.privacy)
// ============================================================================

export const PRIVACY_POLICY: LegalDocument = {
  title: 'Gizlilik Politikası',
  blocks: [
    p(`Yürürlük tarihi: ${EFFECTIVE_DATE}`),
    p(
      `Dinç, ${NAME} tarafından geliştirilen bir antrenman takip uygulamasıdır. Bu sayfa Gizlilik Politikası'nın özetidir; tam metin web sayfasındadır.`
    ),
    p(
      '**Kısaca:** Hesap açmadan kullanırsan tüm bilgilerin yalnızca telefonunda kalır. Hesap açarsan antrenmanların ve rutinlerin hesabına yedeklenir; vücut ölçülerin ve profil bilgilerin yine yalnızca telefonunda kalır. Reklam ve analitik yoktur; verilerin satılmaz.'
    ),
    p('**1. Hesap açarsan işlenen bilgiler**'),
    list(
      'Hesap bilgileri: e-posta adresin, şifren (tek yönlü şifrelenmiş) ve görünen adın',
      'Eşitlenen antrenman verileri: rutinler, antrenmanlar, setler, ağırlık ve tekrarlar, RIR değerleri, kardiyo süreleri ve notlar',
      'Bildirim bilgileri: telefonunun bildirim kimliği (push token), cihaz platformu ve bildirim tercihlerin',
      'Teknik bilgiler: bağlantılarda IP adresin ve bağlantı zamanı'
    ),
    p('Vücut ölçüleri, profil bilgileri ve uygulama ayarları eşitlenmez.'),
    p('**2. Salona katılırsan**'),
    p(
      "Salon üyeliğini ve derslere katılımını salonun yöneticileri ve hocaları görebilir; diğer üyeler yalnızca kişi sayısını görür. Salon duyuruları ve katılacağın derslerdeki değişiklikler telefon bildirimi olarak gelir; Ayarlar'dan kapatabilirsin. Salon yöneticisinin yüklediği logo herkese açık bir adreste saklanır."
    ),
    p(
      'Salon girişinde QR okutursan giriş ve çıkış saatlerin kaydedilir; salon yöneticisi ve izin verdiğin hocan görebilir. Diğer üyeler yalnızca salondaki toplam kişi sayısını görür.'
    ),
    p('**3. Bilgileri kimler işler**'),
    list(
      'Supabase Inc.: hesap, eşitlenen antrenmanlar, salon üyeliği, salon girişleri, bildirim bilgileri ve salon logoları; Frankfurt (Avrupa Birliği) sunucuları, yurt dışına aktarım sayılır',
      "Google: giriş ve doğrulama e-postaları (Gmail); Android'de telefon bildirimleri (Firebase Cloud Messaging)",
      'Expo (650 Industries, Inc., ABD): uygulama güncelleme kontrolü ve telefon bildirimlerinin iletimi',
      'GitHub: egzersiz görselleri'
    ),
    p('Bildirimlerde bildirim kimliği ve bildirim metni iletilir; antrenman verisi iletilmez.'),
    p('**4. İzinler**'),
    list(
      'Bildirimler: dinlenme süresi, ders hatırlatmaları, salon duyuruları ve ders değişiklikleri için',
      'Tam zamanlı alarm (Android): dinlenme süresi bildiriminin zamanında gelmesi için',
      'Fotoğraf seçme: yalnızca salon yöneticisi logo yüklerken, sistemin fotoğraf seçicisiyle seçtiği tek görsel; uygulama galerine erişmez',
      'Kamera: yalnızca "Salona giriş"e bastığında, salon girişindeki QR kodu okumak için açılır; görüntü kaydedilmez, hiçbir yere gönderilmez'
    ),
    p('Uygulama konum, mikrofon veya rehbere erişmez.'),
    p('**5. Yedek dosyaları**'),
    p(
      'Yedek dosyası şifrelenmez; nereye kaydedeceğini ya da kiminle paylaşacağını sen seçersin. Güvendiğin bir yerde sakla.'
    ),
    p('**6. Saklama ve silme**'),
    p(
      'Hesabın sen silene kadar saklanır. Ayarlar → Hesap ve salon → Hesabımı sil ile hesabını ve sunucudaki verilerini kalıcı olarak silebilirsin; sunucu yedeklerinden en geç 30 gün içinde silinir. Uygulamaya erişemiyorsan web sayfasındaki hesap silme yolunu izle.'
    ),
    p('**7. Hakların ve iletişim**'),
    p(
      `Verilerini uygulama içinden düzenleyebilir, silebilir ve yedek alarak dışa aktarabilirsin. KVKK kapsamındaki diğer hakların için ${EMAIL} adresine yaz; talepler en geç 30 gün içinde ücretsiz yanıtlanır.`
    ),
    p('Dinç 18 yaş ve üzeri içindir ve bilerek çocuklardan bilgi toplamaz.'),
  ],
};

// ============================================================================
// METİN 2 — KVKK Aydınlatma Metni
// ============================================================================

export const KVKK_NOTICE: LegalDocument = {
  title: 'KVKK Aydınlatma Metni',
  blocks: [
    p(`**Veri sorumlusu:** ${NAME}, ${EMAIL}`),
    p(
      '**İşlenen veriler:** Profil bilgileri (cinsiyet, doğum tarihi, boy), vücut ölçüleri (kilo, yağ oranı, çevre ölçüleri), antrenman kayıtları ve notlar. Hesap açarsan ayrıca e-posta adresin, görünen adın, bildirim kimliğin ve bildirim tercihlerin; salona katılırsan salon üyeliğin ve ders katılımların. Kilo ve vücut ölçüleri, KVKK md. 6 kapsamında sağlık verisi olarak değerlendirilebilecek özel nitelikli kişisel verilerdir.'
    ),
    p(
      '**İşleme amacı:** Antrenmanlarını kaydetmen, ilerlemeni grafik ve istatistiklerle görmen ve vücut ölçülerini takip etmen; hesap açarsan antrenmanlarının eşitlenmesi, salon üyeliği, ders programı ve salon bildirimleri.'
    ),
    p(
      '**Toplama yöntemi ve hukuki sebep:** Veriler, uygulamaya senin girdiğin bilgilerden elde edilir. Genel nitelikli veriler, kullandığın hizmetin sunulması için gerekli olmasına (md. 5/2-c) dayanır. Sağlık verisi sayılabilecek vücut ölçüleri yalnızca açık rızana (md. 6/2) dayanılarak ve yalnızca cihazında işlenir; sunucuya gönderilmez. Rıza vermezsen bu alanları kullanmadan uygulamanın geri kalanını kullanmaya devam edebilirsin.'
    ),
    p(
      "**Aktarım:** Hesapsız kullanımda verilerin hiçbir kişi ya da kuruluşa aktarılmaz. Hesap açarsan hesap ve eşitlenen antrenman verilerin Supabase Inc.'in Frankfurt (Avrupa Birliği) sunucularında saklanır; e-postalar Google (Gmail), Android bildirimleri Google (Firebase Cloud Messaging) ve Expo (ABD) üzerinden iletilir. Bunlar yurt dışına aktarım sayılır; ayrıntılar Gizlilik Politikası'nda. Uygulama güncelleme kontrolünde Expo'ya yalnızca uygulama sürümü, platform bilgisi ve IP adresi ulaşır. Yedek dosyasını paylaşmak senin tercihindir; veri sorumlusu bu aktarıma taraf değildir."
    ),
    p(
      '**Saklama süresi:** Telefondaki veriler sen silene veya uygulamayı kaldırana kadar cihazında kalır. Sunucudaki veriler hesabını silene kadar saklanır; hesap silinince sunucu yedeklerinden de en geç 30 gün içinde silinir.'
    ),
    p(
      `**Hakların (KVKK md. 11):** Verilerinin işlenip işlenmediğini öğrenme, bilgi talep etme, işleme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme, aktarıldığı üçüncü kişileri bilme, eksik veya yanlış işlenmişse düzeltilmesini, şartları oluştuğunda silinmesini isteme, bu işlemlerin aktarılan kişilere bildirilmesini isteme, otomatik sistemlerle analiz sonucu aleyhine bir sonuç çıkmasına itiraz etme ve kanuna aykırı işleme nedeniyle zararın giderilmesini talep etme haklarına sahipsin. Bu hakların çoğunu uygulama içinden doğrudan kullanabilirsin (düzenleme, silme, dışa aktarma, Hesabımı sil). Diğer talepler için ${EMAIL} adresine yazabilirsin; talepler en geç 30 gün içinde ücretsiz yanıtlanır.`
    ),
  ],
};

export const LEGAL_DOCUMENTS: Record<LegalDocId, LegalDocument> = {
  privacy: PRIVACY_POLICY,
  kvkk: KVKK_NOTICE,
};

// ============================================================================
// METİN 3 — Açık Rıza
// ============================================================================

export const HEALTH_CONSENT_TEXT = {
  title: 'Vücut ölçülerinin işlenmesine açık rıza',
  body: "Kilo, yağ oranı ve çevre ölçülerimin, ilerlememi takip edebilmem amacıyla yalnızca cihazımda saklanarak işlenmesine, Aydınlatma Metni'ni okuyarak açık rıza veriyorum. Bu rızayı istediğim zaman Ayarlar'dan geri alabileceğimi biliyorum.",
  checkboxLabel: 'Onaylıyorum',
} as const;

// ============================================================================
// METİN 4 — Kısa uyarılar
// ============================================================================

/** Yedek paylaşım ekranı açılmadan önce ("Bir daha gösterme" ile) */
export const BACKUP_SHARE_WARNING =
  'Yedek dosyası şifrelenmez ve vücut ölçülerini de içerir. Yalnızca güvendiğin bir yere kaydet.';

/** Rıza geri alınırken */
export const CONSENT_WITHDRAW_PROMPT = {
  title: 'Vücut ölçüsü kayıtların ne olsun?',
  deleteAll: 'Hepsini sil',
  keep: 'Sakla, yeni girişi kapat',
  cancel: 'Vazgeç',
} as const;

// ============================================================================
// Kalın yazı
// ============================================================================

export interface TextSpan {
  text: string;
  bold: boolean;
}

/** "**Kısaca:** metin" → [{Kısaca:, kalın}, { metin}]. Eşsiz ** düz kalır. */
export function parseBold(text: string): TextSpan[] {
  const spans: TextSpan[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  for (let m = re.exec(text); m != null; m = re.exec(text)) {
    if (m.index > last) spans.push({ text: text.slice(last, m.index), bold: false });
    spans.push({ text: m[1]!, bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) spans.push({ text: text.slice(last), bold: false });
  return spans;
}
