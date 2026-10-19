/**
 * Geri bildirim ayrıntısı (v3.6d, yalnızca yönetici): tam metin, fotoğraf,
 * yazar ("Anonim üye" ise kimlik yok), durum değiştirme, yanıt yazma,
 * silme (onaylı). Yanıt yazılınca ya da "Çözüldü" olunca yazara bildirim
 * gider (anonimse de; kimlik yönetime açılmaz).
 */

import { useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Trash2 } from 'lucide-react-native';

import { useGymFeedback } from '@/hooks/useFeedback';
import { useColors } from '@/hooks/useTheme';
import {
  FEEDBACK_REPLY_MAX,
  FEEDBACK_STATUSES,
  answerFeedback,
  authorLabel,
  canSetStatus,
  categoryLabel,
  counterText,
  deleteFeedback,
  type FeedbackStatus,
} from '@/lib/feedback';
import { formatDateTime } from '@/lib/format';
import { getSupabase } from '@/lib/supabase';
import { FeedbackStatusBadge } from '@/components/FeedbackStatusBadge';
import { Card, Chip, DangerButton, PrimaryButton } from '@/components/ui';

export default function FeedbackDetailScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const { id, gymId } = useLocalSearchParams<{ id: string; gymId: string }>();
  const { list, photos, allowed, loaded, refresh } = useGymFeedback(gymId ?? null);
  const item = list.find((f) => f.id === id) ?? null;

  const [status, setStatus] = useState<FeedbackStatus>('new');
  const [reply, setReply] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Liste yenilenince formu ezme: kayıt bir kez forma alınır
  const initFor = useRef<string | null>(null);
  useEffect(() => {
    if (!item || initFor.current === item.id) return;
    initFor.current = item.id;
    setStatus(item.status);
    setReply(item.reply ?? '');
  }, [item]);

  useEffect(() => {
    if (allowed && !loaded) void refresh();
  }, [allowed, loaded, refresh]);

  if (!allowed || !item) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        <Stack.Screen options={{ title: 'Geri bildirim' }} />
        <Text className="text-muted text-base text-center">
          {allowed && !loaded ? 'Yükleniyor…' : 'Geri bildirim bulunamadı. Silinmiş olabilir.'}
        </Text>
      </View>
    );
  }

  const changed = status !== item.status || reply.trim() !== (item.reply ?? '');

  const save = async () => {
    if (reply.trim().length > FEEDBACK_REPLY_MAX) {
      Alert.alert('Yanıt çok uzun', `En fazla ${FEEDBACK_REPLY_MAX} karakter.`);
      return;
    }
    setSaving(true);
    const result = await answerFeedback(getSupabase(), item.id, status, reply);
    setSaving(false);
    if (!result.ok) {
      Alert.alert('Kaydedilemedi', result.error.message);
      return;
    }
    initFor.current = null;
    await refresh();
    router.back();
  };

  const confirmDelete = () =>
    Alert.alert('Geri bildirim silinsin mi?', 'Metin ve fotoğraf kalıcı olarak silinir; üyenin listesinden de kalkar.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          const result = await deleteFeedback(getSupabase(), item);
          setDeleting(false);
          if (!result.ok) {
            Alert.alert('Silinemedi', result.error.message);
            return;
          }
          await refresh();
          router.back();
        },
      },
    ]);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-bg">
      <Stack.Screen options={{ title: 'Geri bildirim' }} />
      <ScrollView contentContainerClassName="px-5 pt-4 pb-12 gap-4" keyboardShouldPersistTaps="handled">
        <View className="gap-2 px-1">
          <View className="flex-row items-center gap-2">
            <FeedbackStatusBadge status={item.status} />
            <Text className="text-muted text-sm">{categoryLabel(item.category)}</Text>
          </View>
          <Text className="text-muted text-sm">
            {authorLabel(item)} · {formatDateTime(item.createdAt)}
          </Text>
        </View>

        <Card className="gap-3">
          <Text className="text-fg text-base leading-6">{item.body}</Text>
          {item.photoPath && photos[item.photoPath] && (
            <Image
              source={{ uri: photos[item.photoPath] }}
              style={{ width: '100%', aspectRatio: 3 / 4, borderRadius: 12 }}
              contentFit="contain"
            />
          )}
        </Card>

        <Card className="gap-3">
          <Text className="text-muted text-xs uppercase tracking-widest">Durum</Text>
          <View className="flex-row flex-wrap gap-2">
            {FEEDBACK_STATUSES.filter((s) => canSetStatus(item.status, s.key)).map((s) => (
              <Chip key={s.key} label={s.label} active={status === s.key} onPress={() => setStatus(s.key)} />
            ))}
          </View>
          <Text className="text-muted text-xs uppercase tracking-widest mt-2">Yanıt</Text>
          <TextInput
            value={reply}
            onChangeText={setReply}
            placeholder="Üyeye yanıtın (opsiyonel)"
            placeholderTextColor={COLORS.muted}
            multiline
            maxLength={FEEDBACK_REPLY_MAX + 50}
            className="bg-bg-elevated text-fg text-base rounded-xl px-4 py-3 min-h-[96px]"
            style={{ textAlignVertical: 'top' }}
          />
          <Text className="text-muted text-xs text-right tabular-nums">{counterText(reply, FEEDBACK_REPLY_MAX)}</Text>
          <Text className="text-muted text-xs leading-5">
            Yanıt yazınca ya da "Çözüldü" yapınca üyeye bildirim gider{item.anonymous ? '; kim olduğu sana açılmaz' : ''}.
          </Text>
        </Card>

        <PrimaryButton
          label={saving ? 'Kaydediliyor...' : 'Kaydet'}
          loading={saving}
          disabled={!changed || saving}
          onPress={() => void save()}
        />
        <DangerButton label={deleting ? 'Siliniyor...' : 'Sil'} icon={Trash2} loading={deleting} onPress={confirmDelete} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
