import { Text, View } from 'react-native';
import { Link } from 'expo-router';
import { CalendarDays, Check, Megaphone, Pin } from 'lucide-react-native';

import { useAnnouncements } from '@/hooks/useAnnouncements';
import { useClassSchedule } from '@/hooks/useClassSchedule';
import { useGymMembership } from '@/hooks/useGymMembership';
import { useColors } from '@/hooks/useTheme';
import { featuredAnnouncement, unreadCount } from '@/lib/announcements';
import {
  canEditSchedule,
  changeSummary,
  isPast,
  scheduleForGym,
  todaySummary,
  type ClassOccurrence,
} from '@/lib/classes';
import { formatAgo } from '@/lib/format';
import { Card } from '@/components/ui';

/**
 * Salon kartları (v3.2b / v3.2c). v3.6c'de ana sayfadan Salon sekmesine
 * taşındı; yönetici paneli de bugünün derslerini katılımcı sayısıyla
 * gösteriyor.
 */

/**
 * Salon duyurusu (v3.2b): sabitlenmiş varsa o, yoksa en yenisi. Okunmamış
 * duyuru varsa nokta. Dokununca duyurular ekranı. Duyuru yoksa görünmez.
 */
export function AnnouncementCard({ gymId }: { gymId: string }) {
  const COLORS = useColors();
  const { items, lastSeenAt } = useAnnouncements();
  const featured = featuredAnnouncement(items.filter((a) => a.gymId === gymId));
  if (!featured) return null;
  const unread = unreadCount(items, lastSeenAt) > 0;
  return (
    <Link href="/announcements" asChild>
      <Card className="gap-1.5">
        <View className="flex-row items-center gap-2">
          {featured.pinned ? <Pin color={COLORS.accent} size={14} /> : <Megaphone color={COLORS.accent} size={14} />}
          <Text className="text-fg text-base font-semibold flex-1" numberOfLines={1}>
            {featured.title}
          </Text>
          {unread && <View className="w-2 h-2 rounded-full bg-accent" accessibilityLabel="Okunmamış duyuru var" />}
        </View>
        <Text className="text-muted text-sm leading-5" numberOfLines={2}>
          {featured.body}
        </Text>
        <Text className="text-muted text-xs">
          {[featured.authorName, formatAgo(featured.createdAt, Date.now())].filter(Boolean).join(' · ')}
        </Text>
      </Card>
    </Link>
  );
}

/**
 * Bugünün dersleri (v3.2c): saat sırasıyla saat, ders, hoca; iptal üstü
 * çizili, değişiklik notlu; katıldığı derste ✓. Bugün ders yoksa yarının
 * ilk dersi. Dokununca program ekranı. Salonun programı yoksa görünmez
 * (yöneticiye "Programı oluştur"). `showCounts`: katılımcı sayısı (panel).
 */
export function TodayClassesCard({ gymId, showCounts = false }: { gymId: string; showCounts?: boolean }) {
  const COLORS = useColors();
  const { memberships } = useGymMembership();
  const { templates, exceptions, attendance } = useClassSchedule();
  const schedule = scheduleForGym({ templates, exceptions }, gymId);
  if (schedule.templates.length === 0) {
    if (!canEditSchedule(gymId, memberships)) return null;
    return (
      <Link href="/classes" asChild>
        <Card className="flex-row items-center gap-2">
          <CalendarDays color={COLORS.accent} size={14} />
          <Text className="text-muted text-sm flex-1">Ders programı yok · Programı oluştur →</Text>
        </Card>
      </Link>
    );
  }
  const nowMs = Date.now();
  const summary = todaySummary(schedule, nowMs);
  return (
    <Link href="/classes" asChild>
      <Card className="gap-2">
        <View className="flex-row items-center gap-2">
          <CalendarDays color={COLORS.accent} size={14} />
          <Text className="text-fg text-base font-semibold flex-1">Bugünün dersleri</Text>
          <Text className="text-muted text-xs">Program →</Text>
        </View>
        {summary.kind === 'today' ? (
          summary.items.map((o) => (
            <TodayClassRow
              key={o.key}
              occurrence={o}
              past={isPast(o, nowMs)}
              joined={attendance.mine.includes(o.key)}
              count={showCounts ? (attendance.counts[o.key] ?? 0) : null}
            />
          ))
        ) : summary.kind === 'tomorrow' ? (
          <Text className="text-muted text-sm">
            Bugün ders yok · Yarın {summary.first.startTime} {summary.first.name}
          </Text>
        ) : (
          <Text className="text-muted text-sm">Bugün ve yarın ders yok</Text>
        )}
      </Card>
    </Link>
  );
}

function TodayClassRow({
  occurrence: o,
  past,
  joined,
  count,
}: {
  occurrence: ClassOccurrence;
  past: boolean;
  joined: boolean;
  /** Katılımcı sayısı (yalnızca panelde) */
  count: number | null;
}) {
  const COLORS = useColors();
  const cancelled = o.status === 'cancelled';
  const change = changeSummary(o);
  return (
    <View className={past || cancelled ? 'opacity-50' : ''}>
      <View className="flex-row items-center gap-3">
        <Text className={`text-fg text-sm font-semibold tabular-nums w-12 ${cancelled ? 'line-through' : ''}`}>
          {o.startTime}
        </Text>
        <Text className={`text-fg text-sm flex-shrink ${cancelled ? 'line-through' : ''}`} numberOfLines={1}>
          {o.name}
        </Text>
        <Text className="text-muted text-sm flex-1" numberOfLines={1}>
          {o.instructorName}
        </Text>
        {cancelled && <Text className="text-danger text-xs font-semibold">İptal</Text>}
        {count != null && !cancelled && <Text className="text-muted text-xs tabular-nums">{count} kişi</Text>}
        {joined && !cancelled && <Check color={COLORS.accent} size={14} accessibilityLabel="Katılıyorsun" />}
      </View>
      {change != null && <Text className="text-accent text-xs ml-[60px] mt-0.5">{change}</Text>}
    </View>
  );
}

/** Ana sayfa: okunmamış duyuru varsa tek satırlık uyarı (kart Salon sekmesinde) */
export function AnnouncementAlert() {
  const COLORS = useColors();
  const { primary } = useGymMembership();
  const { items, lastSeenAt } = useAnnouncements();
  const unread = unreadCount(items, lastSeenAt);
  if (!primary || unread === 0) return null;
  return (
    <Link href="/announcements" asChild>
      <Card className="flex-row items-center gap-2 py-3">
        <Megaphone color={COLORS.accent} size={14} />
        <Text className="text-fg text-sm font-semibold flex-1">
          {unread === 1 ? 'Yeni duyuru var' : `${unread} yeni duyuru`}
        </Text>
        <Text className="text-muted text-xs">Oku →</Text>
      </Card>
    </Link>
  );
}
