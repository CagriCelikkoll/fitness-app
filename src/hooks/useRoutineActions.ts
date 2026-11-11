import { Alert } from 'react-native';
import { eq } from 'drizzle-orm';

import { routines } from '@/db/schema';
import { useDb } from '@/hooks/useDb';
import { duplicateRoutine } from '@/lib/routineCards';

type RoutineTarget = { id: string; name: string };

/** Rutin silme (onaylı) ve kopyalama: Rutinler sekmesi ve rutin kapağı */
export function useRoutineActions() {
  const db = useDb();

  const confirmDelete = (routine: RoutineTarget, onDeleted?: () => void) => {
    Alert.alert('Rutini Sil', `"${routine.name}" rutinini silmek istediğine emin misin?`, [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: async () => {
          await db.delete(routines).where(eq(routines.id, routine.id));
          onDeleted?.();
        },
      },
    ]);
  };

  const copy = (routine: RoutineTarget, onCopied?: () => void) => {
    duplicateRoutine(db, routine.id)
      .then(() => onCopied?.())
      .catch((err) => {
        console.error('[ROUTINES] Kopyalanamadı:', err);
        Alert.alert('Hata', String(err));
      });
  };

  return { confirmDelete, copy };
}
