import { Modal, Pressable, ScrollView, View } from 'react-native';
import { X } from 'lucide-react-native';

import type { Exercise } from '@/db/schema';
import { ExerciseDetailContent } from '@/components/ExerciseDetailContent';
import { NoteEditor } from '@/components/NoteEditor';
import { IconButton } from '@/components/ui';
import { Text } from '@/components/ui/Text';
import { useDb } from '@/hooks/useDb';
import { useSheetBottomPadding } from '@/hooks/useSafeBottom';
import type { LastSessionData } from '@/lib/lastSession';
import { saveSessionExerciseNote } from '@/lib/notes';

/**
 * Odak modunun alttan açılan paneli: "Nasıl yapılır" (mevcut detay
 * içeriği) ya da hareket notu. Tek Modal, görünüm değişiyor (iç içe Modal
 * yok); içinden router.push yok.
 */
export function FocusSheet({
  mode,
  onClose,
  exercise,
  sessionExerciseId,
  initialNote,
  lastSession,
}: {
  mode: 'info' | 'note' | null;
  onClose: () => void;
  exercise: Exercise;
  sessionExerciseId: string;
  initialNote: string | null;
  lastSession: LastSessionData | null;
}) {
  const db = useDb();
  const sheetPadding = useSheetBottomPadding();
  return (
    <Modal visible={mode != null} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-black/60 justify-end">
        <Pressable className="flex-1" onPress={onClose} accessibilityLabel="Paneli kapat" />
        <View
          className="bg-bg rounded-t-3xl border-t border-border max-h-[85%]"
          style={{ paddingBottom: sheetPadding }}
        >
          <View className="flex-row items-center justify-between px-5 pt-4 pb-2">
            <Text className="text-fg text-lg font-bold">{mode === 'note' ? 'Hareket notu' : 'Nasıl yapılır'}</Text>
            <IconButton icon={X} accessibilityLabel="Kapat" onPress={onClose} variant="ghost" />
          </View>
          {mode === 'info' && (
            <ScrollView contentContainerClassName="px-5 pb-4">
              <ExerciseDetailContent exercise={exercise} />
            </ScrollView>
          )}
          {mode === 'note' && (
            <ScrollView contentContainerClassName="px-5 pb-4 gap-3" keyboardShouldPersistTaps="handled">
              {lastSession?.notes && (
                <Text className="text-muted text-sm">📝 Geçen sefer: {lastSession.notes}</Text>
              )}
              {/* key: başka harekete geçince alan yeniden kurulsun */}
              <NoteEditor
                key={sessionExerciseId}
                initialValue={initialNote}
                onSave={(text) => saveSessionExerciseNote(db, sessionExerciseId, text)}
                addLabel="Not ekle"
                placeholder="Bu hareketle ilgili not (ör. sol omuzda sıkışma)"
              />
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}
