/**
 * Uygulama içi yasal metinler — `docs/yasal-metinler.md`'nin aynısı.
 *
 * Metinleri burada değiştirme, kısaltma, yeniden yazma: kaynak md
 * dosyası. `test/legal.test.ts` md dosyası varsa ikisini birebir
 * karşılaştırıyor.
 *
 * Kalın yazı `**...**` olarak duruyor; `LegalText` bileşeni gösteriyor
 * (markdown paketi yok). Metin bölüm dizisi: paragraf ya da madde listesi.
 */

/** Ad, e-posta ve yürürlük tarihi tek yerden. Şimdilik yer tutucu. */
export const LEGAL_CONTACT = {
  name: '[Ad Soyad]',
  email: '[iletişim e-postası]',
  effectiveDate: '[yürürlük tarihi]',
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
// METİN 1 — Gizlilik Politikası
// ============================================================================

export const PRIVACY_POLICY: LegalDocument = {
  title: 'Gizlilik Politikası',
  blocks: [
    p(`Yürürlük tarihi: ${EFFECTIVE_DATE}`),
    p(
      `Dinç, ${NAME} tarafından geliştirilen bir antrenman takip uygulamasıdır. Bu politika, uygulamanın hangi bilgileri işlediğini ve bu bilgilerin nerede durduğunu açıklar.`
    ),
    p(
      '**Kısaca:** Girdiğin tüm bilgiler yalnızca senin cihazında saklanır. Hesap açman gerekmez. Verilerin bize veya başka bir şirkete gönderilmez; biz onları göremeyiz.'
    ),
    p('**1. Uygulamaya girdiğin bilgiler**'),
    list(
      'Profil bilgileri: cinsiyet, doğum tarihi, boy',
      'Vücut ölçüleri: kilo, yağ oranı, çevre ölçüleri',
      'Antrenman kayıtları: rutinler, setler, tekrarlar, ağırlıklar, RIR değerleri, kardiyo süreleri, notlar, haftalık hedef',
      'Uygulama ayarları'
    ),
    p(
      'Kilo ve vücut ölçüleri sağlık verisi sayılabilir. Bu bilgileri girmek tamamen isteğe bağlıdır; uygulama onlar olmadan da çalışır.'
    ),
    p('**2. Bilgilerin saklandığı yer**'),
    p(
      'Tüm bilgiler cihazındaki uygulama veritabanında tutulur. Sunucumuz yoktur. Uygulamayı silersen bu bilgiler de silinir.'
    ),
    p('**3. Yedekleme dosyaları**'),
    p(
      '"Yedekle" dediğinde verilerin bir dosyaya yazılır ve bu dosyayı nereye kaydedeceğini ya da kiminle paylaşacağını sen seçersin (ör. Google Drive, e-posta, mesajlaşma uygulaması). Dosya bu noktadan sonra seçtiğin hizmetin gizlilik koşullarına tabidir. Yedek dosyası şifrelenmez; güvendiğin bir yerde sakla.'
    ),
    p('**4. İnternet bağlantısı ne için kullanılır**'),
    p(
      'Uygulama şu durumlarda internete bağlanır; hiçbirinde antrenman veya vücut verin gönderilmez:'
    ),
    list(
      'Uygulama güncellemeleri: Uygulama açılışta Expo (650 Industries, Inc., ABD) sunucularından yeni sürüm olup olmadığını kontrol eder. Bu istekte uygulama sürümü ve platform bilgisi gönderilir; her internet isteğinde olduğu gibi IP adresin de karşı sunucuya ulaşır.',
      'Egzersiz görselleri: Egzersiz resimleri GitHub sunucularından indirilir ve cihazda önbelleğe alınır.',
      "Video bağlantıları: Bir egzersizin videosunu açarsan YouTube uygulaması veya tarayıcı açılır; o andan sonra YouTube'un koşulları geçerlidir."
    ),
    p('**5. İzinler**'),
    list(
      'Bildirimler: Dinlenme süren bittiğinde haber vermek için. Bildirimler cihazda planlanır, uzaktan gönderilmez. Ayarlardan kapatabilirsin.',
      'Tam zamanlı alarm (Android): Dinlenme bildiriminin zamanında gelmesi için.'
    ),
    p('Uygulama konum, kamera, mikrofon, rehber veya fotoğraflara erişmez.'),
    p('**6. Analitik, reklam ve üçüncü taraflar**'),
    p(
      'Uygulamada reklam, analitik, çökme raporlama veya izleme aracı yoktur. Verilerin satılmaz ve kimseyle paylaşılmaz.'
    ),
    p('**7. Çocuklar**'),
    p(
      'Dinç 18 yaş ve üzeri kullanıcılar için tasarlanmıştır ve bilerek çocuklardan bilgi toplamaz.'
    ),
    p('**8. Hakların**'),
    p(
      "Verilerin tamamen senin kontrolündedir: uygulama içinden düzenleyebilir, silebilir, yedek alarak dışa aktarabilir veya uygulamayı kaldırarak hepsini silebilirsin. KVKK kapsamındaki hakların için Aydınlatma Metni'ne bak."
    ),
    p('**9. Değişiklikler**'),
    p(
      'Bu politika değişirse güncel sürüm yayınlanır ve yürürlük tarihi güncellenir. Verilerin cihaz dışına çıkmasını gerektiren bir değişiklik olursa uygulama içinde ayrıca onayın istenir.'
    ),
    p('**10. İletişim**'),
    p(`${NAME} — ${EMAIL}`),
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
      '**İşlenen veriler:** Profil bilgileri (cinsiyet, doğum tarihi, boy), vücut ölçüleri (kilo, yağ oranı, çevre ölçüleri), antrenman kayıtları ve notlar. Kilo ve vücut ölçüleri, KVKK md. 6 kapsamında sağlık verisi olarak değerlendirilebilecek özel nitelikli kişisel verilerdir.'
    ),
    p(
      '**İşleme amacı:** Antrenmanlarını kaydetmen, ilerlemeni grafik ve istatistiklerle görmen ve vücut ölçülerini takip etmen.'
    ),
    p(
      '**Toplama yöntemi ve hukuki sebep:** Veriler, uygulamaya senin girdiğin bilgilerden otomatik olmayan yolla elde edilir ve yalnızca cihazında işlenir. Genel nitelikli veriler, kullandığın hizmetin sunulması için gerekli olmasına (md. 5/2-c) dayanır. Sağlık verisi sayılabilecek vücut ölçüleri ise yalnızca açık rızana (md. 6/2) dayanılarak işlenir; rıza vermezsen bu alanları kullanmadan uygulamanın geri kalanını kullanmaya devam edebilirsin.'
    ),
    p(
      '**Aktarım:** Verilerin veri sorumlusuna, yurt içinde veya yurt dışında herhangi bir kişi ya da kuruluşa aktarılmaz. Yedek dosyasını bir bulut hizmetine kaydetmek veya biriyle paylaşmak senin kendi tercihindir ve veri sorumlusu bu aktarıma taraf değildir. Uygulama güncelleme kontrolü sırasında Expo (ABD) sunucularına yalnızca uygulama sürümü, platform bilgisi ve teknik olarak kaçınılmaz olan IP adresi ulaşır; antrenman veya vücut verisi gönderilmez.'
    ),
    p(
      '**Saklama süresi:** Veriler sen silene veya uygulamayı kaldırana kadar cihazında kalır.'
    ),
    p(
      `**Hakların (KVKK md. 11):** Verilerinin işlenip işlenmediğini öğrenme, bilgi talep etme, işleme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme, aktarıldığı üçüncü kişileri bilme, eksik veya yanlış işlenmişse düzeltilmesini, şartları oluştuğunda silinmesini isteme, bu işlemlerin aktarılan kişilere bildirilmesini isteme, otomatik sistemlerle analiz sonucu aleyhine bir sonuç çıkmasına itiraz etme ve kanuna aykırı işleme nedeniyle zararın giderilmesini talep etme haklarına sahipsin. Veriler yalnızca cihazında bulunduğu için bu hakların çoğunu uygulama içinden doğrudan kullanabilirsin (düzenleme, silme, dışa aktarma). Diğer talepler için ${EMAIL} adresine yazabilirsin; talepler en geç 30 gün içinde ücretsiz yanıtlanır.`
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
