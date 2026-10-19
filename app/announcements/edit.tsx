/**
 * Duyuru yaz / düzenle (v3.2b). Hoca ve yönetici.
 *
 * - Başlık (en fazla 80) ve metin (en fazla 1000) sayaçlı; düz yazı.
 * - "Sabitle" yalnızca yönetici için.
 * - Kaydetmeden çıkarken "Vazgeçilsin mi?".
 * - Düzenlemede "Sil" (onaylı).
 *
 * Görünümdeki rol kontrolleri kolaylık içindir; yetkiyi sunucu belirler
 * (0004_announcements.sql). Reddedilirse sunucunun mesajı gösterilir.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { Trash2 } from 'lucide-react-native';

import { useAnnouncements } from '@/hooks/useAnnouncements';
import { useGymMembership } from '@/hooks/useGymMembership';
import { useColors } from '@/hooks/useTheme';
import {
  BODY_MAX,
  TITLE_MAX,
  canManage,
  canPin,
  charCount,
  createAnnouncement,
  deleteAnnouncement,
  draftError,
  isDraftDirty,
  updateAnnouncement,
  writableGyms,
  type AnnouncementDraft,
} from '@/lib/announcements';
import { getSupabase } from '@/lib/supabase';
import { Card, Chip, DangerButton, PrimaryButton } from '@/components/ui';

const INPUT_CLASS = 'bg-bg-elevated text-fg text-base px-4 rounded-xl';

export default function EditAnnouncementScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const navigation = useNavigation();
  // Ders programından (v3.2c): yeni duyuru önceden doldurulmuş gelebilir
  const params = useLocalSearchParams<{ id?: string; gymId?: string; title?: string; body?: string }>();
  const { id } = params;
  const { userId, memberships } = useGymMembership();
  const { items, refresh } = useAnnouncements();

  const existing = id ? (items.find((a) => a.id === id) ?? null) : null;
  const gyms = writableGyms(memberships);
  const original: AnnouncementDraft | null = existing
    ? { title: existing.title, body: existing.body, pinned: existing.pinned }
    : null;

  const presetGym = gyms.find((g) => g.gymId === params.gymId)?.gymId;
  const [gymId, setGymId] = useState<string | null>(existing?.gymId ?? presetGym ?? gyms[0]?.gymId ?? null);
  const [draft, setDraft] = useState<AnnouncementDraft>(
    original ?? { title: params.title ?? '', body: params.body ?? '', pinned: false }
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Kaydet / sil sonrası çıkışta soru sorulmasın */
  const leaving = useRef(false);

  // Üyelikler geç gelirse varsayılan salon
  useEffect(() => {
    if (gymId == null && gyms[0]) setGymId(gyms.find((g) => g.gymId === params.gymId)?.gymId ?? gyms[0].gymId);
  }, [gymId, gyms, params.gymId]);

  const dirty = isDraftDirty(draft, original);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (leaving.current || !dirty) return;
      e.preventDefault();
      Alert.alert('Vazgeçilsin mi?', 'Kaydedilmemiş değişiklikler kaybolacak.', [
        { text: 'Düzenlemeye devam', style: 'cancel' },
        { text: 'Vazgeç', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
      ]);
    });
    return unsubscribe;
  }, [navigation, dirty]);

  const title = id ? 'Duyuruyu düzenle' : 'Duyuru yaz';

  if (id && !existing) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        <Stack.Screen options={{ title }} />
        <Text className="text-muted text-base text-center">Duyuru bulunamadı. Silinmiş olabilir.</Text>
      </View>
    );
  }
  if (!userId || gyms.length === 0 || (existing && !canManage(existing, userId, memberships))) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        <Stack.Screen options={{ title }} />
        <Text className="text-muted text-base text-center">
          Duyuruları salonun hocaları ve yöneticisi yazabilir.
        </Text>
      </View>
    );
  }

  const validation = draftError(draft);
  const pinAllowed = gymId != null && canPin(gymId, memberships);

  const finish = async () => {
    leaving.current = true;
    await refresh();
    router.back();
  };

  const save = async () => {
    if (validation || gymId == null || busy) return;
    setBusy(true);
    setError(null);
    const client = getSupabase();
    const result = existing
      ? await updateAnnouncement(client, existing.id, draft)
      : await createAnnouncement(client, gymId, { ...draft, pinned: pinAllowed && draft.pinned });
    if (!result.ok) {
      setBusy(false);
      setError(result.error.message);
      return;
    }
    await finish();
  };

  const confirmDelete = () => {
    if (!existing) return;
    Alert.alert('Duyuru silinsin mi?', 'Salondaki herkes için kaldırılır. Bu işlem geri alınamaz.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          const result = await deleteAnnouncement(getSupabase(), existing.id);
          if (!result.ok) {
            setBusy(false);
            setError(result.error.message);
            return;
          }
          await finish();
        },
      },
    ]);
  };

  const titleCount = charCount(draft.title.trim());
  const bodyCount = charCount(draft.body.trim());

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-bg">
      <Stack.Screen options={{ title }} />
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-5 pt-4 gap-4 pb-12"
        keyboardShouldPersistTaps="handled"
      >
        <Card className="gap-4">
          {!existing && gyms.length > 1 && (
            <View className="gap-2">
              <Text className="text-muted text-xs">Salon</Text>
              <View className="flex-row flex-wrap gap-2">
                {gyms.map((g) => (
                  <Chip
                    key={g.gymId}
                    label={g.gymName}
                    active={g.gymId === gymId}
                    onPress={() => setGymId(g.gymId)}
                  />
                ))}
              </View>
            </View>
          )}

          <Counted label="Başlık" count={titleCount} max={TITLE_MAX}>
            <TextInput
              value={draft.title}
              onChangeText={(t) => setDraft((d) => ({ ...d, title: t }))}
              editable={!busy}
              placeholder="Ör. Pazartesi salon kapalı"
              placeholderTextColor={COLORS.muted}
              className={`${INPUT_CLASS} h-12`}
            />
          </Counted>

          <Counted label="Metin" count={bodyCount} max={BODY_MAX}>
            <TextInput
              value={draft.body}
              onChangeText={(t) => setDraft((d) => ({ ...d, body: t }))}
              editable={!busy}
              multiline
              textAlignVertical="top"
              placeholder="Üyelerin görecek."
              placeholderTextColor={COLORS.muted}
              className={`${INPUT_CLASS} py-3 min-h-40`}
            />
          </Counted>

          {pinAllowed && (
            <View className="flex-row items-center justify-between">
              <View className="flex-1 pr-3">
                <Text className="text-fg text-base">Sabitle</Text>
                <Text className="text-muted text-xs mt-0.5">Listede ve ana sayfada en üstte durur.</Text>
              </View>
              <Switch
                value={draft.pinned}
                onValueChange={(v) => setDraft((d) => ({ ...d, pinned: v }))}
                disabled={busy}
                trackColor={{ true: COLORS.accentFill }}
              />
            </View>
          )}

          <PrimaryButton
            label={existing ? 'Kaydet' : 'Yayınla'}
            disabled={validation != null || busy || (existing != null && !dirty)}
            loading={busy}
            onPress={() => void save()}
          />
          {validation != null && dirty && <Text className="text-muted text-xs">{validation}</Text>}
          {error != null && <Text className="text-danger text-sm leading-5">{error}</Text>}
        </Card>

        {existing && <DangerButton label="Duyuruyu sil" icon={Trash2} disabled={busy} onPress={confirmDelete} />}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Counted({
  label,
  count,
  max,
  children,
}: {
  label: string;
  count: number;
  max: number;
  children: React.ReactNode;
}) {
  return (
    <View>
      <View className="flex-row justify-between mb-2">
        <Text className="text-muted text-xs">{label}</Text>
        <Text className={`text-xs tabular-nums ${count > max ? 'text-danger' : 'text-muted'}`}>
          {count}/{max}
        </Text>
      </View>
      {children}
    </View>
  );
}
