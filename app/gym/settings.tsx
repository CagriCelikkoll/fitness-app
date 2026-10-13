/**
 * Salon ayarları (v3.2d, yalnızca yönetici): salon adı, katılım kodu
 * (göster, paylaş, yeni kod), salon rengi. Logo bu turda yok (resim
 * seçmek native paket ister); yeri hazır.
 *
 * Kopyalama için ayrı native paket yok: kod seçilebilir metin (uzun bas →
 * kopyala) ve sistem paylaşım ekranında da "Kopyala" var.
 */

import { useCallback, useEffect, useState } from 'react';
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
import { Check, ImageIcon, RefreshCw, Share2 } from 'lucide-react-native';

import { useGymMembership } from '@/hooks/useGymMembership';
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
import { getSupabase } from '@/lib/supabase';
import { Card, PrimaryButton, SecondaryButton } from '@/components/ui';
import { COLORS } from '@/theme';

export default function GymSettingsScreen() {
  const { gymId } = useLocalSearchParams<{ gymId: string }>();
  const { memberships, refresh: refreshMemberships } = useGymMembership();
  const isAdmin = gymId != null && canManageGym(gymId, memberships);

  const [settings, setSettings] = useState<GymSettings | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<'name' | 'color' | 'code' | null>(null);
  const [error, setError] = useState<string | null>(null);

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
            className="bg-bg-elevated text-white text-base px-4 h-12 rounded-xl"
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
            className="text-white text-3xl font-bold tracking-[6px] tabular-nums text-center py-2"
            accessibilityLabel={code ? `Katılım kodu ${code.split('').join(' ')}` : undefined}
          >
            {code ?? '······'}
          </Text>
          <Text className="text-muted text-xs leading-5 text-center">
            Kopyalamak için koda uzun bas ya da paylaş.
          </Text>
          <PrimaryButton label="Kodu paylaş" icon={Share2} disabled={!code} onPress={share} />
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
              return (
                <Pressable
                  key={c.hex}
                  onPress={() => !selected && busy == null && void save({ primaryColor: c.hex }, 'color')}
                  accessibilityRole="button"
                  accessibilityLabel={c.label}
                  accessibilityState={{ selected }}
                  className={`w-12 h-12 rounded-full items-center justify-center active:opacity-70 ${
                    selected ? 'border-2 border-white' : ''
                  }`}
                  style={{ backgroundColor: c.hex }}
                >
                  {selected && <Check color={COLORS.accentFg} size={20} />}
                </Pressable>
              );
            })}
          </View>
          <Text className="text-muted text-xs leading-5">Ana sayfadaki salon satırında görünür.</Text>
        </Card>

        <Card className="gap-2 opacity-60">
          <View className="flex-row items-center gap-2">
            <ImageIcon color={COLORS.muted} size={16} />
            <Text className="text-white text-base">Logo</Text>
          </View>
          <Text className="text-muted text-xs leading-5">Yakında: bir sonraki uygulama güncellemesiyle.</Text>
        </Card>

        {error != null && <Text className="text-danger text-sm leading-5">{error}</Text>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
