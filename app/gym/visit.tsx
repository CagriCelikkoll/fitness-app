/**
 * Elle giriş (v3.6c, yalnızca yönetici). Salon paneli → "Elle giriş".
 * QR okutmayı unutan üye için: üye, tarih, giriş saati, çıkış saati
 * (opsiyonel). Saatler salon saatiyle. Sunucu `source = manual` yazar.
 */

import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Check } from 'lucide-react-native';

import { useGymMembers } from '@/hooks/useGymMembers';
import { useGymMembership } from '@/hooks/useGymMembership';
import { useColors } from '@/hooks/useTheme';
import { useGymVisits } from '@/hooks/useVisits';
import { gymNow } from '@/lib/classes';
import { canManageGym, matchesSearch } from '@/lib/gymAdmin';
import { dateKeyToParts, partsToDateKey, type DateParts } from '@/lib/format';
import { getSupabase } from '@/lib/supabase';
import { gymLocalToIso, manualVisit } from '@/lib/visits';
import { DateInput } from '@/components/DateInput';
import { Card, PrimaryButton } from '@/components/ui';

/** "1830" → "18:30" gibi yazarken iki noktayı kendisi koyar */
function timeInput(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
}

export default function ManualVisitScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const { gymId } = useLocalSearchParams<{ gymId: string }>();
  const { memberships } = useGymMembership();
  const { members } = useGymMembers(gymId ?? null);
  const { refresh } = useGymVisits(gymId ?? null);
  const [query, setQuery] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [date, setDate] = useState<DateParts>(() => dateKeyToParts(gymNow(Date.now()).date));
  const [inTime, setInTime] = useState('');
  const [outTime, setOutTime] = useState('');
  const [saving, setSaving] = useState(false);

  if (!gymId || !canManageGym(gymId, memberships)) {
    return (
      <View className="flex-1 bg-bg items-center justify-center p-6">
        <Stack.Screen options={{ title: 'Elle giriş' }} />
        <Text className="text-muted text-base text-center">Elle giriş yalnızca yöneticilere açık.</Text>
      </View>
    );
  }

  const list = members.filter((m) => matchesSearch(m, query)).slice(0, 30);
  const selected = members.find((m) => m.userId === userId) ?? null;

  const save = async () => {
    const dateKey = partsToDateKey(date);
    const checkedInAt = dateKey ? gymLocalToIso(dateKey, inTime) : null;
    const checkedOutAt = outTime.trim() && dateKey ? gymLocalToIso(dateKey, outTime) : null;
    if (!userId) return Alert.alert('Eksik bilgi', 'Bir üye seç.');
    if (!checkedInAt) return Alert.alert('Eksik bilgi', 'Tarihi ve giriş saatini "18:30" gibi yaz.');
    if (outTime.trim() && !checkedOutAt) return Alert.alert('Eksik bilgi', 'Çıkış saatini "19:45" gibi yaz ya da boş bırak.');
    if (checkedOutAt && checkedOutAt <= checkedInAt) return Alert.alert('Eksik bilgi', 'Çıkış saati girişten sonra olmalı.');
    setSaving(true);
    const result = await manualVisit(getSupabase(), { gymId, userId, checkedInAt, checkedOutAt });
    setSaving(false);
    if (!result.ok) return Alert.alert('Eklenemedi', result.error.message);
    void refresh();
    router.back();
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-bg">
      <Stack.Screen options={{ title: 'Elle giriş' }} />
      <ScrollView contentContainerClassName="px-5 pt-4 pb-12 gap-4" keyboardShouldPersistTaps="handled">
        <Card className="gap-3">
          <Text className="text-muted text-xs uppercase tracking-widest">Üye</Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Ada göre ara"
            placeholderTextColor={COLORS.muted}
            className="bg-bg-elevated text-fg text-base px-4 h-12 rounded-xl"
          />
          {list.map((m) => (
            <Pressable
              key={m.userId}
              onPress={() => setUserId(m.userId)}
              className="flex-row items-center py-2 active:opacity-70"
            >
              <Text className={`flex-1 text-base ${m.name ? 'text-fg' : 'text-muted'}`} numberOfLines={1}>
                {m.name ?? 'Adı girilmemiş üye'}
              </Text>
              {m.userId === userId && <Check color={COLORS.accent} size={18} />}
            </Pressable>
          ))}
        </Card>

        <Card className="gap-3">
          <DateInput label="Tarih" value={date} onChange={setDate} />
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Text className="text-muted text-xs mb-2">Giriş saati</Text>
              <TextInput
                value={inTime}
                onChangeText={(v) => setInTime(timeInput(v))}
                placeholder="18:30"
                placeholderTextColor={COLORS.muted}
                keyboardType="number-pad"
                className="bg-bg-elevated text-fg text-base tabular-nums px-4 h-12 rounded-xl"
              />
            </View>
            <View className="flex-1">
              <Text className="text-muted text-xs mb-2">Çıkış saati (ops.)</Text>
              <TextInput
                value={outTime}
                onChangeText={(v) => setOutTime(timeInput(v))}
                placeholder="19:45"
                placeholderTextColor={COLORS.muted}
                keyboardType="number-pad"
                className="bg-bg-elevated text-fg text-base tabular-nums px-4 h-12 rounded-xl"
              />
            </View>
          </View>
          <Text className="text-muted text-xs leading-5">Çıkış boş kalırsa süre bilinmiyor sayılır; gün sayısına girer.</Text>
        </Card>

        <PrimaryButton
          label={saving ? 'Ekleniyor...' : selected ? `${selected.name ?? 'Üye'} için ekle` : 'Ekle'}
          loading={saving}
          disabled={saving}
          onPress={() => void save()}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
