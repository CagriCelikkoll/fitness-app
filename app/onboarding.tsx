/**
 * İlk açılış (karşılama) akışı: beş kısa adım.
 *
 * 1. Hoş geldin — ne işe yaradığı
 * 2. Gizlilik — yasal metin bağlantıları ve vücut ölçüsü açık rızası
 *    (kutu boş gelir; işaretsiz "Devam" declined yazar, akış sürer)
 * 3. Profil — boy/doğum tarihi/cinsiyet (Ayarlar'daki formun aynısı)
 * 4. Program — haftalık gün sayısına göre hazır program önerisi
 * 5. İpuçları — ✓ ile onaylama ve yedek alma
 *
 * Tek ekran, adım durumu içeride: adımlar seçilen programı paylaşıyor ve
 * ayrı ayrı derin bağlantıya ihtiyaçları yok.
 *
 * Kime gösterileceğine ana sayfa karar veriyor (`app/(tabs)/index.tsx`);
 * Ayarlar → Hakkında'dan da açılabiliyor. "Atla" ya da "Başla" bayrağı
 * set edip Antrenman sekmesine gider. İlk adımdaki "Geri yükle"
 * Ayarlar'daki yedek akışını açar; başarılıysa bayrak set edilip ana
 * sayfaya gidilir.
 */

import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { eq } from 'drizzle-orm';
import Storage from 'expo-sqlite/kv-store';
import {
  Check,
  Dumbbell,
  History,
  Plus,
  TrendingUp,
  Upload,
  type LucideIcon,
} from 'lucide-react-native';

import { useDb } from '@/hooks/useDb';
import { useBackupRestore } from '@/hooks/useBackupRestore';
import { appSettings, type AppSettings } from '@/db/schema';
import { applyTemplate } from '@/lib/applyTemplate';
import {
  TRAINING_DAYS_OPTIONS,
  markOnboardingDone,
  saveGoalForAddedTemplate,
  suggestedTemplate,
  type TrainingDaysChoice,
} from '@/lib/onboarding';
import { ProfileFields, useProfileForm } from '@/components/ProfileForm';
import { ConsentCard } from '@/components/ConsentCard';
import { setHealthConsent } from '@/hooks/useHealthConsent';
import {
  Card,
  Chip,
  PrimaryButton,
  SecondaryButton,
} from '@/components/ui';
import { COLORS } from '@/theme';

const STEP_COUNT = 5;

export default function OnboardingScreen() {
  const db = useDb();
  const router = useRouter();

  const { data: settingsRows, updatedAt } = useLiveQuery(
    db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1)
  );

  const [step, setStep] = useState(0);
  const [choice, setChoice] = useState<TrainingDaysChoice | null>(null);
  const [addedTemplateIds, setAddedTemplateIds] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const next = () => setStep((s) => Math.min(s + 1, STEP_COUNT - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  // Android geri tuşu 2-5. adımlarda bir önceki adıma döner ("Geri" ile
  // aynı). 1. adımda dinleyici yok: varsayılan davranış (çıkış / Ayarlar'a
  // dönüş) kalır. Ekrandan çıkınca ya da adım değişince temizlenir.
  useEffect(() => {
    if (step === 0) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setStep((s) => Math.max(s - 1, 0));
      return true;
    });
    return () => sub.remove();
  }, [step]);

  /** Atla ve Başla: bayrak set edilir, Antrenman sekmesine gidilir */
  const finish = async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      await markOnboardingDone(Storage);
    } catch (err) {
      // Bayrak yazılamazsa karşılama bir dahaki açılışta yeniden çıkar;
      // kullanıcıyı burada bekletmenin anlamı yok.
      console.error('[ONBOARDING] Bayrak yazılamadı:', err);
    }
    // Ayarlar'dan açıldıysa sekmelere geri döner, ilk açılışta (sekmeler
    // yığında yok) bu ekranın yerine geçer.
    router.dismissTo('/workout');
  };

  const addTemplate = async () => {
    const template = choice != null ? suggestedTemplate(choice) : undefined;
    if (!template) return;
    setAdding(true);
    try {
      await applyTemplate(db, template);
      setAddedTemplateIds((ids) => [...ids, template.id]);
      // Hedef seçimde değil, program eklenince yazılır. Hata programın
      // eklenmesini geri almasın; sadece loglanır.
      saveGoalForAddedTemplate(Storage, template).catch((err) =>
        console.error('[ONBOARDING] Haftalık hedef kaydedilemedi:', err)
      );
    } catch (err) {
      console.error('[ONBOARDING] Program eklenemedi:', err);
      Alert.alert('Hata', String(err));
    } finally {
      setAdding(false);
    }
  };

  // Eski uygulamadan yedekle geçen kullanıcı karşılamayı atlayıp verisine
  // ulaşsın. Akış Ayarlar'dakiyle aynı; başarılıysa bayrak set edilip ana
  // sayfaya gidilir.
  const { importing, startRestore } = useBackupRestore(async () => {
    try {
      await markOnboardingDone(Storage);
    } catch (err) {
      console.error('[ONBOARDING] Bayrak yazılamadı:', err);
    }
    router.dismissTo('/');
  });

  // v2.2: vücut ölçüsü rızası. Kutu boş gelir; geri dönülünce son seçim
  // korunur. "Devam": işaretliyse granted, değilse declined; ikisinde de
  // akış sürer (karşılamada ölçü soran adım yok, atlanan bir şey yok).
  // Yazılamazsa durum "sorulmadı" kalır, ilk ölçü girişinde yine sorulur.
  const [consentChecked, setConsentChecked] = useState(false);
  const [savingConsent, setSavingConsent] = useState(false);
  const saveConsentAndNext = async () => {
    setSavingConsent(true);
    try {
      await setHealthConsent(consentChecked ? 'granted' : 'declined');
    } catch (err) {
      console.error('[ONBOARDING] Rıza kaydedilemedi:', err);
    } finally {
      setSavingConsent(false);
    }
    next();
  };

  const layout = { step, onSkip: finish, onBack: back, skipDisabled: finishing };

  if (step === 0) {
    return (
      <StepLayout
        {...layout}
        footer={
          <>
            <PrimaryButton label="Devam" onPress={next} />
            <Pressable
              onPress={() => void startRestore()}
              disabled={importing}
              accessibilityRole="button"
              hitSlop={8}
              className="self-center py-1 active:opacity-60"
            >
              <Text className="text-muted text-sm">
                {importing ? (
                  'Geri yükleniyor...'
                ) : (
                  <>
                    Yedeğin var mı?{' '}
                    <Text className="text-accent font-semibold">Geri yükle</Text>
                  </>
                )}
              </Text>
            </Pressable>
          </>
        }
      >
        <WelcomeStep />
      </StepLayout>
    );
  }

  if (step === 1) {
    return (
      <StepLayout
        {...layout}
        footer={
          <PrimaryButton
            label="Devam"
            loading={savingConsent}
            onPress={() => void saveConsentAndNext()}
          />
        }
      >
        <PrivacyStep checked={consentChecked} onCheckedChange={setConsentChecked} />
      </StepLayout>
    );
  }

  if (step === 2) {
    // Form durumu kayıtlı ayarlardan kuruluyor; ayarlar gelmeden kurulmasın
    if (!updatedAt) {
      return (
        <StepLayout {...layout} footer={null}>
          <View className="pt-10">
            <ActivityIndicator color={COLORS.accent} />
          </View>
        </StepLayout>
      );
    }
    return (
      <ProfileStep
        key={settingsRows?.[0]?.id ?? 'new'}
        layout={layout}
        settings={settingsRows?.[0]}
        onNext={next}
      />
    );
  }

  if (step === 3) {
    return (
      <StepLayout
        {...layout}
        footer={<PrimaryButton label="Devam" onPress={next} />}
      >
        <ProgramStep
          choice={choice}
          onChoose={setChoice}
          addedTemplateIds={addedTemplateIds}
          adding={adding}
          onAdd={() => void addTemplate()}
        />
      </StepLayout>
    );
  }

  return (
    <StepLayout
      {...layout}
      footer={
        <PrimaryButton
          label="Başla"
          loading={finishing}
          onPress={() => void finish()}
        />
      }
    >
      <TipsStep />
    </StepLayout>
  );
}

// ============================================================================
// Ortak iskelet: üstte Geri / Atla, ortada içerik, altta noktalar + düğme
// ============================================================================

interface StepLayoutProps {
  step: number;
  onSkip: () => void;
  onBack: () => void;
  skipDisabled: boolean;
  footer: React.ReactNode;
  children: React.ReactNode;
}

function StepLayout({
  step,
  onSkip,
  onBack,
  skipDisabled,
  footer,
  children,
}: StepLayoutProps) {
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between px-5 h-12">
        {step > 0 ? (
          <Pressable onPress={onBack} hitSlop={12} className="active:opacity-60">
            <Text className="text-muted text-base font-medium">Geri</Text>
          </Pressable>
        ) : (
          <View />
        )}
        <Pressable
          onPress={onSkip}
          disabled={skipDisabled}
          hitSlop={12}
          className="active:opacity-60"
        >
          <Text className="text-muted text-base font-medium">Atla</Text>
        </Pressable>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="px-5 pt-4 pb-6 gap-4"
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>

      <View
        className="px-5 pt-3 gap-4 border-t border-border bg-bg"
        style={{ paddingBottom: Math.max(insets.bottom, 16) }}
      >
        <StepDots step={step} />
        {footer}
      </View>
    </View>
  );
}

function StepDots({ step }: { step: number }) {
  return (
    <View
      className="flex-row justify-center gap-2"
      accessibilityLabel={`Adım ${step + 1} / ${STEP_COUNT}`}
    >
      {Array.from({ length: STEP_COUNT }, (_, i) => (
        <View
          key={i}
          className={`h-2 rounded-full ${
            i === step ? 'w-6 bg-accent' : 'w-2 bg-border'
          }`}
        />
      ))}
    </View>
  );
}

function StepTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View className="mb-2">
      <Text className="text-white text-3xl font-bold tracking-tight">
        {title}
      </Text>
      {subtitle != null && (
        <Text className="text-muted text-sm leading-5 mt-2">{subtitle}</Text>
      )}
    </View>
  );
}

// ============================================================================
// 1) Hoş geldin
// ============================================================================

const WELCOME_POINTS: { icon: LucideIcon; text: string }[] = [
  {
    icon: Dumbbell,
    text: 'Hazır programla başla ya da kendi rutinini kur',
  },
  {
    icon: History,
    text: 'Setlerini kaydet; bir sonraki antrenmanda önceki değerlerin hazır gelir',
  },
  {
    icon: TrendingUp,
    text: 'İlerlemeni, rekorlarını ve hangi kası ne kadar çalıştırdığını gör',
  },
];

function WelcomeStep() {
  return (
    <>
      <StepTitle title="Hoş geldin 💪" />
      {WELCOME_POINTS.map(({ icon: Icon, text }) => (
        <Card key={text} className="flex-row items-center">
          <View className="w-11 h-11 rounded-full bg-accent items-center justify-center">
            <Icon color={COLORS.accentFg} size={20} />
          </View>
          <Text className="flex-1 ml-4 text-white text-base leading-6">
            {text}
          </Text>
        </Card>
      ))}
      <Text className="text-muted text-xs text-center mt-2">
        Verilerin sadece bu telefonda saklanır, internet gerekmez.
      </Text>
    </>
  );
}

// ============================================================================
// 2) Gizlilik ve vücut ölçüsü rızası
// ============================================================================

function PrivacyStep({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const router = useRouter();
  const openDoc = (doc: 'privacy' | 'kvkk') =>
    router.push({ pathname: '/legal/[doc]', params: { doc } });

  return (
    <>
      <StepTitle
        title="Gizlilik"
        subtitle="Verilerin yalnızca bu telefonda durur. Hesap yok, sunucu yok."
      />
      <View className="flex-row flex-wrap gap-x-5 gap-y-2">
        <Pressable onPress={() => openDoc('privacy')} hitSlop={6} className="active:opacity-60">
          <Text className="text-accent text-sm font-semibold">Gizlilik Politikası →</Text>
        </Pressable>
        <Pressable onPress={() => openDoc('kvkk')} hitSlop={6} className="active:opacity-60">
          <Text className="text-accent text-sm font-semibold">Aydınlatma Metni →</Text>
        </Pressable>
      </View>
      <ConsentCard
        checked={checked}
        onCheckedChange={onCheckedChange}
        showNoticeLink={false}
      />
      <Text className="text-muted text-xs leading-5">
        Onaylamazsan da uygulamanın geri kalanını kullanabilirsin; kilo ve
        vücut ölçüsü takibi kapalı kalır.
      </Text>
    </>
  );
}

// ============================================================================
// 3) Profil
// ============================================================================

function ProfileStep({
  layout,
  settings,
  onNext,
}: {
  layout: Omit<StepLayoutProps, 'footer' | 'children'>;
  settings?: AppSettings;
  onNext: () => void;
}) {
  const form = useProfileForm(settings);

  // Boş form da kaydedilir (alanlar null kalır); geçersiz girişte
  // hata gösterilir ve adım ilerlemez — "Atla" yine çalışır.
  const handleNext = async () => {
    if (await form.save()) onNext();
  };

  return (
    <StepLayout
      {...layout}
      footer={
        <PrimaryButton
          label="Devam"
          loading={form.saving}
          onPress={() => void handleNext()}
        />
      }
    >
      <StepTitle
        title="Profil"
        subtitle="Vücut kitle indeksi ve bazal metabolizma hesapları için. İstersen sonra Ayarlar'dan da girebilirsin."
      />
      <Card className="gap-4">
        <ProfileFields form={form} />
      </Card>
    </StepLayout>
  );
}

// ============================================================================
// 4) Program
// ============================================================================

function ProgramStep({
  choice,
  onChoose,
  addedTemplateIds,
  adding,
  onAdd,
}: {
  choice: TrainingDaysChoice | null;
  onChoose: (choice: TrainingDaysChoice) => void;
  addedTemplateIds: string[];
  adding: boolean;
  onAdd: () => void;
}) {
  const template = choice != null ? suggestedTemplate(choice) : undefined;
  const added = template != null && addedTemplateIds.includes(template.id);

  return (
    <>
      <StepTitle title="Haftada kaç gün antrenman yapmayı düşünüyorsun?" />
      <View className="flex-row flex-wrap gap-2">
        {TRAINING_DAYS_OPTIONS.map((opt) => (
          <Chip
            key={String(opt.value)}
            label={opt.label}
            active={choice === opt.value}
            onPress={() => onChoose(opt.value)}
          />
        ))}
      </View>

      {choice === 'custom' && (
        <Card>
          <Text className="text-white text-base leading-6">
            Antrenman sekmesinden kendi rutinlerini oluşturabilirsin. Hazır
            programlara da istediğin zaman oradan göz atabilirsin.
          </Text>
        </Card>
      )}

      {template && (
        <Card className="gap-3">
          <Text className="text-muted text-xs tracking-widest">ÖNERİLEN PROGRAM</Text>
          <Text className="text-white text-xl font-semibold tracking-tight">
            {template.name}
          </Text>
          <Text className="text-white text-sm">
            {template.days.map((d, i) => `${i + 1}. ${d.name}`).join('  ·  ')}
          </Text>
          <Text className="text-muted text-sm leading-5">
            {template.description}
          </Text>
          {added ? (
            <View className="flex-row items-center gap-2 mt-1">
              <Check color={COLORS.accent} size={18} strokeWidth={3} />
              <Text className="text-accent text-sm font-semibold">
                {template.dayCount} rutin Antrenman sekmesine eklendi
              </Text>
            </View>
          ) : (
            <SecondaryButton
              label="Bu programı ekle"
              icon={Plus}
              loading={adding}
              onPress={onAdd}
              className="mt-1"
            />
          )}
        </Card>
      )}
    </>
  );
}

// ============================================================================
// 5) Bilmen gereken iki şey
// ============================================================================

function TipsStep() {
  return (
    <>
      <StepTitle title="Bilmen gereken iki şey" />

      <Card className="gap-3">
        <Text className="text-white text-lg font-semibold">✓ ile onayla</Text>
        <Text className="text-muted text-sm leading-5">
          Setin değerlerini girdikten sonra sağdaki ✓'ye bas. Onaylanmayan
          setler antrenman bitince sorulur.
        </Text>
        <SetRowMock />
      </Card>

      <Card className="gap-3">
        <View className="flex-row items-center gap-2">
          <Upload color={COLORS.text} size={18} />
          <Text className="text-white text-lg font-semibold">Yedek al</Text>
        </View>
        <Text className="text-muted text-sm leading-5">
          Verilerin sadece bu telefonda. Telefon değiştirirsen ya da
          uygulamayı silersen kaybolmasın diye ara sıra Ayarlar'dan yedek al.
        </Text>
      </Card>
    </>
  );
}

/**
 * Antrenman ekranındaki set satırının statik taklidi: değerler girilmiş,
 * ✓ henüz basılmamış ve vurgulu. Gerçek bileşen değil, dokunulmaz.
 */
function SetRowMock() {
  return (
    <View
      className="flex-row items-center px-2 py-2 rounded-2xl bg-bg-elevated/50"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text className="text-white text-lg font-semibold tabular-nums w-7">1</Text>
      <Text className="flex-1 text-muted text-sm tabular-nums text-center">
        60 × 8
      </Text>
      <View className="w-16 h-11 rounded-xl bg-bg-elevated items-center justify-center">
        <Text className="text-white text-lg font-semibold tabular-nums">62,5</Text>
      </View>
      <View className="w-12 h-11 rounded-xl bg-bg-elevated items-center justify-center ml-2">
        <Text className="text-white text-lg font-semibold tabular-nums">8</Text>
      </View>
      <View className="w-11 h-11 rounded-xl items-center justify-center ml-2 border-2 border-accent">
        <Check color={COLORS.accent} size={20} strokeWidth={3} />
      </View>
    </View>
  );
}
