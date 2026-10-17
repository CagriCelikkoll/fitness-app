/**
 * Salon ayarları (v3.2d, yalnızca yönetici): salon adı, katılım kodu
 * (göster, kopyala, paylaş, yeni kod), salon rengi (v3.5: iki temada
 * önizleme), logo (v3.3: seç → kare kırp → küçült → yükle; kaldır).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Check, Copy, ImageIcon, RefreshCw, Share2, Trash2 } from 'lucide-react-native';

import { useGymMembership } from '@/hooks/useGymMembership';
import { useTheme } from '@/hooks/useTheme';
import {
  GYM_COLORS,
  GYM_NAME_MAX,
  canManageGym,
  fetchGymSettings,
  fetchJoinCode,
  gymNameError,
  joinCodeShareText,
  normalizeGymName,
  regenerateJoinCode,
  updateGymSettings,
  type GymSettings,
} from '@/lib/gymAdmin';
import { removeGymLogo, uploadGymLogo } from '@/lib/gymLogo';
import { pickGymLogo } from '@/lib/gymLogoNative';
import { newId } from '@/lib/id';
import { getSupabase } from '@/lib/supabase';
import { DINC_LIME, gymAccentTones } from '@/theme';
import { GymColorPreview } from '@/components/GymColorPreview';
import { GymLogo } from '@/components/GymLogo';
import { Card, PrimaryButton, SecondaryButton } from '@/components/ui';

export default function GymSettingsScreen() {
  const { scheme, colors: COLORS } = useTheme();
  const { gymId } = useLocalSearchParams<{ gymId: string }>();
  const { memberships, refresh: refreshMemberships } = useGymMembership();
  const isAdmin = gymId != null && canManageGym(gymId, memberships);

  const [settings, setSettings] = useState<GymSettings | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<'name' | 'color' | 'code' | 'logo' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    []
  );

  const load = useCallback(async () => {
    if (!gymId) return;
    const client = getSupabase();
    const [s, c] = await Promise.all([fetchGymSettings(client, gymId), fetchJoinCode(client, gymId)]);
    if (s.ok) setSettings(s.value);
    if (c.ok) setCode(c.value);
    const failed = !s.ok ? s.error : !c.ok ? c.error : null;
    setError(failed?.message ?? null);
  }, [gymId]);

  useFocusEffect(
    useCallback(() => {
      if (isAdmin) void load();
    }, [isAdmin, load])
  );

  useEffect(() => {
    if (settings) setName(settings.name);
  }, [settings]);

  if (!gymId || !isAdmin) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        <Stack.Screen options={{ title: 'Salon ayarları' }} />
        <Text className="text-muted text-base text-center">Salon ayarlarını yalnızca yönetici değiştirir.</Text>
      </View>
    );
  }

  const nameError = gymNameError(name);
  const nameChanged = settings != null && normalizeGymName(name) !== settings.name;

  const save = async (patch: Partial<GymSettings>, kind: 'name' | 'color') => {
    setBusy(kind);
    setError(null);
    const r = await updateGymSettings(getSupabase(), gymId, patch);
    setBusy(null);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setSettings(r.value);
    // Ana sayfa salon satırı ve Ayarlar'daki kart
    void refreshMemberships();
  };

  const copy = async () => {
    if (!code) return;
    try {
      await Clipboard.setStringAsync(code);
    } catch (err) {
      console.warn('[GYM-ADMIN] Kopyalanamadı:', err);
      return;
    }
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2000);
  };

  const chooseLogo = async () => {
    if (!settings) return;
    setBusy('logo');
    setError(null);
    let bytes: ArrayBuffer | null;
    try {
      bytes = await pickGymLogo();
    } catch (err) {
      console.warn('[GYM-LOGO] Resim hazırlanamadı:', err);
      setBusy(null);
      setError('Resim açılamadı. Başka bir resim dene.');
      return;
    }
    if (!bytes) {
      setBusy(null);
      return;
    }
    const r = await uploadGymLogo(getSupabase(), gymId, bytes, newId(), settings.logoUrl);
    setBusy(null);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setSettings({ ...settings, logoUrl: r.value });
    void refreshMemberships();
  };

  const confirmRemoveLogo = () => {
    if (!settings?.logoUrl) return;
    Alert.alert('Logo kaldırılsın mı?', 'Yerine salon adının baş harfi görünür.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Kaldır',
        style: 'destructive',
        onPress: async () => {
          setBusy('logo');
          setError(null);
          const r = await removeGymLogo(getSupabase(), gymId, settings.logoUrl);
          setBusy(null);
          if (!r.ok) {
            setError(r.error.message);
            return;
          }
          setSettings({ ...settings, logoUrl: null });
          void refreshMemberships();
        },
      },
    ]);
  };

  const share = () => {
    if (!code || !settings) return;
    Share.share({ message: joinCodeShareText(settings.name, code) }).catch((err) =>
      console.warn('[GYM-ADMIN] Paylaşılamadı:', err)
    );
  };

  const confirmRegenerate = () => {
    Alert.alert(
      'Yeni kod üretilsin mi?',
      'Eski kodu bilen yeni kişiler katılamayacak; mevcut üyeler etkilenmez.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Yeni kod üret',
          style: 'destructive',
          onPress: async () => {
            setBusy('code');
            setError(null);
            const r = await regenerateJoinCode(getSupabase(), gymId);
            setBusy(null);
            if (r.ok) setCode(r.value);
            else setError(r.error.message);
          },
        },
      ]
    );
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-bg">
      <Stack.Screen options={{ title: 'Salon ayarları' }} />
      <ScrollView className="flex-1" contentContainerClassName="px-5 pt-4 gap-4 pb-12" keyboardShouldPersistTaps="handled">
        <Card className="gap-3">
          <View className="flex-row justify-between">
            <Text className="text-muted text-xs">Salon adı</Text>
            <Text className={`text-xs tabular-nums ${[...normalizeGymName(name)].length > GYM_NAME_MAX ? 'text-danger' : 'text-muted'}`}>
              {[...normalizeGymName(name)].length}/{GYM_NAME_MAX}
            </Text>
          </View>
          <TextInput
            value={name}
            onChangeText={setName}
            editable={settings != null && busy == null}
            placeholderTextColor={COLORS.muted}
            className="bg-bg-elevated text-fg text-base px-4 h-12 rounded-xl"
          />
          {nameChanged && nameError != null && <Text className="text-danger text-xs">{nameError}</Text>}
          <PrimaryButton
            label="Adı kaydet"
            loading={busy === 'name'}
            disabled={!nameChanged || nameError != null || busy != null}
            onPress={() => void save({ name }, 'name')}
          />
        </Card>

        <Card className="gap-3">
          <Text className="text-muted text-xs">Katılım kodu</Text>
          <Text
            selectable
            className="text-fg text-3xl font-bold tracking-[6px] tabular-nums text-center py-2"
            accessibilityLabel={code ? `Katılım kodu ${code.split('').join(' ')}` : undefined}
          >
            {code ?? '······'}
          </Text>
          <View className="flex-row gap-2">
            <SecondaryButton
              label={copied ? 'Kopyalandı' : 'Kopyala'}
              icon={copied ? Check : Copy}
              className="flex-1"
              disabled={!code}
              onPress={() => void copy()}
            />
            <PrimaryButton label="Paylaş" icon={Share2} className="flex-1" disabled={!code} onPress={share} />
          </View>
          <SecondaryButton
            label="Yeni kod üret"
            icon={RefreshCw}
            loading={busy === 'code'}
            disabled={!code || busy != null}
            onPress={confirmRegenerate}
          />
        </Card>

        <Card className="gap-3">
          <Text className="text-muted text-xs">Salon rengi</Text>
          <View className="flex-row flex-wrap gap-3">
            {GYM_COLORS.map((c) => {
              const selected = settings?.primaryColor === c.hex;
              // Bu temadaki dolgu tonu (koyu temada salonun kendi rengi)
              const tones = gymAccentTones(c.hex, scheme);
              return (
                <Pressable
                  key={c.hex}
                  onPress={() => !selected && busy == null && void save({ primaryColor: c.hex }, 'color')}
                  accessibilityRole="button"
                  accessibilityLabel={c.label}
                  accessibilityState={{ selected }}
                  className={`w-12 h-12 rounded-full items-center justify-center active:opacity-70 ${
                    selected ? 'border-2 border-fg' : ''
                  }`}
                  style={{ backgroundColor: tones.fill }}
                >
                  {selected && <Check color={tones.onFill} size={20} />}
                </Pressable>
              );
            })}
          </View>
          <GymColorPreview hex={settings?.primaryColor ?? DINC_LIME} />
          <Text className="text-muted text-xs leading-5">
            Ana sayfadaki salon satırında görünür; üyeler "Salon rengini kullan" açıksa düğme ve sekmelerde de.
          </Text>
        </Card>

        <Card className="gap-3">
          <Text className="text-muted text-xs">Logo</Text>
          <View className="flex-row items-center gap-4">
            <GymLogo
              name={settings?.name ?? name}
              logoUrl={settings?.logoUrl}
              gymColor={settings?.primaryColor}
              size={72}
            />
            <View className="flex-1 gap-2">
              <SecondaryButton
                label={settings?.logoUrl ? 'Değiştir' : 'Logo seç'}
                icon={ImageIcon}
                loading={busy === 'logo'}
                disabled={settings == null || busy != null}
                onPress={() => void chooseLogo()}
              />
              {settings?.logoUrl != null && (
                <SecondaryButton label="Kaldır" icon={Trash2} disabled={busy != null} onPress={confirmRemoveLogo} />
              )}
            </View>
          </View>
          <Text className="text-muted text-xs leading-5">
            Kare kırpılıp küçültülür. Ana sayfada ve salon kartında görünür; logo yoksa salon adının baş harfi.
          </Text>
        </Card>

        {error != null && <Text className="text-danger text-sm leading-5">{error}</Text>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
