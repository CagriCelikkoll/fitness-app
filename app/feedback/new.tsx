/**
 * Öneri / Şikâyet (v3.6d, üye). Salon sekmesi → "Öneri / Şikâyet".
 * Kategori çipleri, metin (sayaçlı, 5–1000), isteğe bağlı fotoğraf
 * (sistem seçicisi, ≤1024 px), "İsmim gizli kalsın" (yönetim kim
 * yazdığını görmez). Gönderince "Teşekkürler, salon yönetimine iletildi."
 */

import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { CircleCheck, ImagePlus, X } from 'lucide-react-native';

import { useGymMembership } from '@/hooks/useGymMembership';
import { useColors } from '@/hooks/useTheme';
import {
  FEEDBACK_BODY_MAX,
  FEEDBACK_CATEGORIES,
  counterText,
  submitFeedback,
  validateFeedback,
  type FeedbackCategory,
} from '@/lib/feedback';
import { pickFeedbackPhoto, type PickedPhoto } from '@/lib/feedbackPhotoNative';
import { newId } from '@/lib/id';
import { getSupabase } from '@/lib/supabase';
import { Card, Chip, PrimaryButton, SecondaryButton } from '@/components/ui';

export default function NewFeedbackScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const { gymId: paramGym } = useLocalSearchParams<{ gymId?: string }>();
  const { available, memberships, primary } = useGymMembership();
  const gym = memberships.find((m) => m.gymId === paramGym) ?? primary;

  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [body, setBody] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  if (!available || !gym) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        <Stack.Screen options={{ title: 'Öneri / Şikâyet' }} />
        <Text className="text-muted text-base text-center">Geri bildirim için bir salona üye olman gerekiyor.</Text>
      </View>
    );
  }

  if (sent) {
    return (
      <View className="flex-1 bg-bg items-center justify-center px-8 gap-4">
        <Stack.Screen options={{ title: 'Öneri / Şikâyet' }} />
        <CircleCheck color={COLORS.success} size={56} strokeWidth={1.5} />
        <Text className="text-fg text-xl font-bold text-center">Teşekkürler, salon yönetimine iletildi.</Text>
        <Text className="text-muted text-sm text-center leading-5">
          Yanıt geldiğinde bildirim alırsın; durumunu "Gönderdiklerim"den görebilirsin.
        </Text>
        <PrimaryButton label="Tamam" onPress={() => router.back()} />
        <SecondaryButton
          label="Gönderdiklerim"
          onPress={() => router.replace({ pathname: '/feedback/mine', params: { gymId: gym.gymId } })}
        />
      </View>
    );
  }

  const addPhoto = async () => {
    try {
      const picked = await pickFeedbackPhoto();
      if (picked === 'too_large') Alert.alert('Fotoğraf çok büyük', 'Başka bir fotoğraf seç.');
      else if (picked) setPhoto(picked);
    } catch (e) {
      console.error('[FEEDBACK] Fotoğraf seçilemedi:', e);
      Alert.alert('Fotoğraf eklenemedi', String(e));
    }
  };

  const send = async () => {
    const problem = validateFeedback({ category, body });
    if (problem || !category) {
      Alert.alert('Eksik bilgi', problem ?? 'Bir kategori seç.');
      return;
    }
    setSending(true);
    const result = await submitFeedback(getSupabase(), {
      gymId: gym.gymId,
      category,
      body,
      anonymous,
      photo: photo ? { bytes: photo.bytes, fileId: newId().replace(/-/g, '') } : null,
    });
    setSending(false);
    if (!result.ok) {
      Alert.alert('Gönderilemedi', result.error.message);
      return;
    }
    setSent(true);
  };

  const over = body.trim().length > FEEDBACK_BODY_MAX;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-bg">
      <Stack.Screen options={{ title: 'Öneri / Şikâyet' }} />
      <ScrollView contentContainerClassName="px-5 pt-4 pb-12 gap-4" keyboardShouldPersistTaps="handled">
        <Text className="text-muted text-sm leading-5 px-1">
          {gym.gymName} yönetimine öneri, istek ya da şikâyetini yaz. Hocalar görmez.
        </Text>

        <Card className="gap-3">
          <Text className="text-muted text-xs uppercase tracking-widest">Konu</Text>
          <View className="flex-row flex-wrap gap-2">
            {FEEDBACK_CATEGORIES.map((c) => (
              <Chip key={c.key} label={c.label} active={category === c.key} onPress={() => setCategory(c.key)} />
            ))}
          </View>
        </Card>

        <Card className="gap-2">
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="Örn: Squat rack'in emniyet pimi eksik."
            placeholderTextColor={COLORS.muted}
            multiline
            maxLength={FEEDBACK_BODY_MAX + 50}
            className="text-fg text-base min-h-[120px]"
            style={{ textAlignVertical: 'top' }}
          />
          <Text className={`text-xs text-right tabular-nums ${over ? 'text-danger' : 'text-muted'}`}>{counterText(body)}</Text>
        </Card>

        {photo ? (
          <View className="flex-row items-center gap-3">
            <Image source={{ uri: photo.uri }} style={{ width: 72, height: 72, borderRadius: 12 }} contentFit="cover" />
            <Pressable onPress={() => setPhoto(null)} hitSlop={8} className="flex-row items-center gap-1 active:opacity-60">
              <X color={COLORS.muted} size={16} />
              <Text className="text-muted text-sm">Fotoğrafı kaldır</Text>
            </Pressable>
          </View>
        ) : (
          <SecondaryButton label="Fotoğraf ekle" icon={ImagePlus} onPress={() => void addPhoto()} />
        )}

        <Card className="flex-row items-center gap-3">
          <View className="flex-1">
            <Text className="text-fg text-base font-semibold">İsmim gizli kalsın</Text>
            <Text className="text-muted text-xs mt-0.5">Yönetim kim yazdığını görmez.</Text>
          </View>
          <Switch
            value={anonymous}
            onValueChange={setAnonymous}
            trackColor={{ false: COLORS.border, true: COLORS.accentFill }}
            thumbColor={anonymous ? COLORS.accentFg : COLORS.text}
            ios_backgroundColor={COLORS.border}
          />
        </Card>

        <PrimaryButton label={sending ? 'Gönderiliyor...' : 'Gönder'} loading={sending} disabled={sending} onPress={() => void send()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
