/**
 * Üye ayrıntısı (v3.2d). Yönetici: rol (Üye / Hoca / Yönetici), üyelik
 * bitiş tarihi (gir / temizle), salondan çıkar (onaylı). Hoca salt okur.
 * Yönetici kendi rolünü düşüremez ve kendini buradan çıkaramaz (ayrılma
 * Ayarlar'da); sunucu da aynı kuralları uygular.
 *
 * v3.6a: yöneticiye "Hocası: Duygu Hoca" (salt okunur; bağı yönetici
 * kuramaz, rıza üyede).
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { UserMinus } from 'lucide-react-native';

import { DateInput } from '@/components/DateInput';
import { useGymMembers } from '@/hooks/useGymMembers';
import { useGymMembership } from '@/hooks/useGymMembership';
import { useTrainerLinks } from '@/hooks/useTrainerLinks';
import { roleLabel, type GymRole } from '@/lib/auth';
import { UNNAMED } from '@/lib/classRsvps';
import { gymNow } from '@/lib/classes';
import { dateKeyToParts, partsToDateKey, type DateParts } from '@/lib/format';
import {
  canEditMember,
  canManageGym,
  canViewMembers,
  formatEndDate,
  membershipDaysLeft,
  removeMember,
  updateMember,
} from '@/lib/gymAdmin';
import { getSupabase } from '@/lib/supabase';
import { trainerTitle, trainersOfStudent } from '@/lib/trainers';
import { Card, Chip, DangerButton, PrimaryButton, SecondaryButton } from '@/components/ui';

const ROLES: GymRole[] = ['member', 'trainer', 'admin'];
const EMPTY_PARTS: DateParts = { day: '', month: '', year: '' };

export default function MemberScreen() {
  const router = useRouter();
  const { gymId, userId: targetId } = useLocalSearchParams<{ gymId: string; userId: string }>();
  const { userId, memberships, refresh: refreshMemberships } = useGymMembership();
  const { members, loaded, replace, remove } = useGymMembers(gymId ?? null);
  const member = members.find((m) => m.userId === targetId) ?? null;
  const { links, refreshIfStale } = useTrainerLinks();
  useFocusEffect(
    useCallback(() => {
      refreshIfStale();
    }, [refreshIfStale])
  );

  const [parts, setParts] = useState<DateParts>(EMPTY_PARTS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setParts(member?.membershipEndsOn ? dateKeyToParts(member.membershipEndsOn) : EMPTY_PARTS);
  }, [member?.membershipEndsOn]);

  if (!gymId || !canViewMembers(gymId, memberships)) {
    return <Message text="Üye bilgilerini salonun hocaları ve yöneticisi görür." />;
  }
  if (!member) {
    return <Message text={loaded ? 'Üye bulunamadı. Salondan ayrılmış olabilir.' : 'Yükleniyor…'} />;
  }

  const nowMs = Date.now();
  const name = member.name ?? UNNAMED;
  const editable = canManageGym(gymId, memberships) && canEditMember(member, userId);
  const isMe = member.userId === userId;
  const days = membershipDaysLeft(member.membershipEndsOn, nowMs);
  // Yalnızca yönetici salondaki bütün bağları görür
  const trainers = canManageGym(gymId, memberships)
    ? trainersOfStudent(links.filter((l) => l.gymId === gymId), member.userId)
    : [];

  const anyParts = parts.day !== '' || parts.month !== '' || parts.year !== '';
  const dateKey = anyParts ? partsToDateKey(parts) : null;
  // Yazarken kırmızı olmasın: yıl tamamlanınca denetle
  const dateError =
    anyParts && dateKey == null && parts.year.length === 4 ? 'Geçerli bir tarih gir (GG.AA.YYYY).' : null;
  const dateChanged = (dateKey ?? null) !== (member.membershipEndsOn ?? null) && !(anyParts && dateKey == null);

  const apply = async (patch: { role?: GymRole; membershipEndsOn?: string | null }) => {
    setBusy(true);
    setError(null);
    const r = await updateMember(getSupabase(), gymId, member.userId, patch);
    setBusy(false);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    replace(r.value);
    // Kendi rolü değişmez; yine de üyelik listesi güncel kalsın
    void refreshMemberships();
  };

  const changeRole = (role: GymRole) => {
    if (role === member.role || busy) return;
    const text =
      role === 'admin'
        ? `${name} yönetici olacak: üyeleri, programı ve salon ayarlarını değiştirebilecek.`
        : role === 'trainer'
          ? `${name} hoca olacak: üye listesini ve katılanları görebilecek, duyuru yazabilecek.`
          : `${name} üye olacak: hoca / yönetici yetkileri kalkacak, öğrencileriyle bağı biter.`;
    Alert.alert(`${roleLabel(role)} yapılsın mı?`, text, [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Değiştir', onPress: () => void apply({ role }) },
    ]);
  };

  const confirmRemove = () => {
    Alert.alert(
      'Salondan çıkar',
      `${name} salondan çıkarılacak. Salonun duyurularını ve programını göremeyecek; kendi antrenmanları kendisinde kalır.`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Çıkar',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            setError(null);
            const r = await removeMember(getSupabase(), gymId, member.userId);
            if (!r.ok) {
              setBusy(false);
              setError(r.error.message);
              return;
            }
            remove(member.userId);
            router.back();
          },
        },
      ]
    );
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-bg">
      <Stack.Screen options={{ title: 'Üye' }} />
      <ScrollView className="flex-1" contentContainerClassName="px-5 pt-4 gap-4 pb-12" keyboardShouldPersistTaps="handled">
        <Card className="gap-1">
          <Text className={`text-xl font-semibold ${member.name ? 'text-fg' : 'text-muted'}`}>
            {name}
            {isMe ? ' (sen)' : ''}
          </Text>
          <Text className="text-accent text-sm font-semibold">{roleLabel(member.role)}</Text>
          {member.joinedAt != null && (
            <Text className="text-muted text-xs mt-1">
              Katılım: {formatEndDate(gymNow(Date.parse(member.joinedAt)).date, nowMs)}
            </Text>
          )}
          <Text className={`text-xs ${days != null && days < 0 ? 'text-danger' : 'text-muted'}`}>
            {member.membershipEndsOn
              ? `Üyelik bitişi: ${formatEndDate(member.membershipEndsOn, nowMs)}${days != null && days < 0 ? ' (bitti)' : ''}`
              : 'Üyelik bitişi girilmemiş'}
          </Text>
          {trainers.length > 0 && (
            <Text className="text-muted text-xs">
              Hocası: {trainers.map((l) => trainerTitle(l.trainerName)).join(', ')}
            </Text>
          )}
        </Card>

        {editable ? (
          <>
            <Card className="gap-3">
              <Text className="text-muted text-xs">Rol</Text>
              <View className="flex-row flex-wrap gap-2">
                {ROLES.map((r) => (
                  <Chip key={r} label={roleLabel(r)} active={member.role === r} onPress={() => changeRole(r)} />
                ))}
              </View>
            </Card>

            <Card className="gap-3">
              <DateInput label="Üyelik bitiş tarihi" value={parts} onChange={setParts} error={dateError} />
              <Text className="text-muted text-xs leading-5">
                Bitiş günü dahil. 7 gün kala üyenin ana sayfasında uyarı çıkar.
              </Text>
              <View className="flex-row gap-2">
                <PrimaryButton
                  label="Kaydet"
                  className="flex-1"
                  disabled={busy || !dateChanged || (anyParts && dateKey == null)}
                  onPress={() => void apply({ membershipEndsOn: dateKey })}
                />
                <SecondaryButton
                  label="Temizle"
                  className="flex-1"
                  disabled={busy || member.membershipEndsOn == null}
                  onPress={() => void apply({ membershipEndsOn: null })}
                />
              </View>
            </Card>

            <DangerButton label="Salondan çıkar" icon={UserMinus} disabled={busy} onPress={confirmRemove} />
          </>
        ) : (
          <Text className="text-muted text-xs leading-5 px-1">
            {isMe
              ? 'Kendi rolünü buradan değiştiremezsin. Salondan ayrılmak için Ayarlar → Hesap ve salon.'
              : 'Rolü, üyelik bitişini ve salondan çıkarmayı yalnızca yönetici değiştirir.'}
          </Text>
        )}

        {error != null && <Text className="text-danger text-sm leading-5">{error}</Text>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Message({ text }: { text: string }) {
  return (
    <View className="flex-1 bg-bg items-center justify-center p-6">
      <Stack.Screen options={{ title: 'Üye' }} />
      <Text className="text-muted text-base text-center">{text}</Text>
    </View>
  );
}
