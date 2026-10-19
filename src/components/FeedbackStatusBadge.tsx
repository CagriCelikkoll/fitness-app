import { Text, View } from 'react-native';

import { statusLabel, type FeedbackStatus } from '@/lib/feedback';

const TONE: Record<FeedbackStatus, { box: string; text: string }> = {
  new: { box: 'border-accent', text: 'text-accent' },
  in_progress: { box: 'border-warning', text: 'text-warning' },
  resolved: { box: 'border-success', text: 'text-success' },
};

/** Geri bildirim durumu rozeti (v3.6d): Yeni / İnceleniyor / Çözüldü */
export function FeedbackStatusBadge({ status }: { status: FeedbackStatus }) {
  const tone = TONE[status];
  return (
    <View className={`self-start border rounded-full px-2 py-0.5 ${tone.box}`}>
      <Text className={`text-xs font-semibold ${tone.text}`}>{statusLabel(status)}</Text>
    </View>
  );
}
