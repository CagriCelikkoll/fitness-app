import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Check, LayoutList, ListChecks, Plus } from 'lucide-react-native';

import { useDb } from '@/hooks/useDb';
import { useColors } from '@/hooks/useTheme';
import { PROGRAM_LIMITS } from '@/lib/programs';
import { listRoutinesForProgram } from '@/lib/programRoutines';
import { WORKOUT_TEMPLATES } from '@/lib/workoutTemplates';
import { Card, ListRow, PrimaryButton, SecondaryButton, SectionHeader } from '@/components/ui';

export type ProgramStartPanel = 'templates' | 'routines' | null;

/**
 * Yeni program başlatma (v3.6e): "Yeni program", "Hazır programdan",
 * "Rutinlerimden". Programlarım ve Program ata ekranlarında. Hocanın
 * kişisel rutinleri yalnızca "Rutinlerimden" açılınca listelenir; seçilen
 * her rutin programda bir gün olur. `studentId` verilirse kaydedince o
 * öğrenci atama ekranında seçili gelir.
 */
export function ProgramStartOptions({
  gymId,
  studentId,
  panel,
  onPanel,
}: {
  gymId: string;
  studentId?: string;
  panel: ProgramStartPanel;
  onPanel: (panel: ProgramStartPanel) => void;
}) {
  const COLORS = useColors();
  const router = useRouter();
  const db = useDb();
  const [routineList, setRoutineList] = useState<{ id: string; name: string; exerciseCount: number }[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    if (panel !== 'routines') return;
    let alive = true;
    listRoutinesForProgram(db)
      .then((rows) => alive && setRoutineList(rows))
      .catch((e) => {
        console.error('[PROGRAMS] Rutinler okunamadı:', e);
        if (alive) setRoutineList([]);
      });
    return () => {
      alive = false;
    };
  }, [panel, db]);

  const extra = studentId ? { student: studentId } : {};
  const toggle = (id: string) =>
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= PROGRAM_LIMITS.daysMax ? prev : [...prev, id]
    );

  return (
    <View className="gap-3">
      <PrimaryButton
        label="Yeni program"
        icon={Plus}
        onPress={() => router.push({ pathname: '/programs/edit', params: { gymId, ...extra } })}
      />
      <View className="flex-row gap-2">
        <SecondaryButton
          label="Hazır programdan"
          icon={LayoutList}
          className="flex-1"
          onPress={() => onPanel(panel === 'templates' ? null : 'templates')}
        />
        <SecondaryButton
          label="Rutinlerimden"
          icon={ListChecks}
          className="flex-1"
          onPress={() => onPanel(panel === 'routines' ? null : 'routines')}
        />
      </View>

      {panel === 'templates' && (
        <View className="gap-2">
          <SectionHeader
            title="Hazır programdan başla"
            description="Seçtiğin program taslak olarak açılır; kaydetmeden önce değiştirebilirsin."
            variant="label"
            className="px-1"
          />
          <Card flush className="px-4">
            {WORKOUT_TEMPLATES.map((t, i) => (
              <ListRow
                key={t.id}
                divider={i > 0}
                chevron
                onPress={() => {
                  onPanel(null);
                  router.push({ pathname: '/programs/edit', params: { gymId, template: t.id, ...extra } });
                }}
              >
                <Text className="text-fg text-base font-semibold">{t.name}</Text>
                <Text className="text-muted text-xs mt-0.5">{t.dayCount} gün</Text>
              </ListRow>
            ))}
          </Card>
        </View>
      )}

      {panel === 'routines' && (
        <View className="gap-2">
          <SectionHeader
            title="Rutinlerimden oluştur"
            description={`Seçtiğin her rutin programda bir gün olur (en fazla ${PROGRAM_LIMITS.daysMax}). Rutinlerin değişmez; notların programa geçmez.`}
            variant="label"
            className="px-1"
          />
          {routineList == null ? null : routineList.length === 0 ? (
            <Text className="text-muted text-sm px-1">Kayıtlı rutinin yok.</Text>
          ) : (
            <>
              <Card flush className="px-4">
                {routineList.map((r, i) => {
                  const order = picked.indexOf(r.id);
                  const on = order >= 0;
                  return (
                    <Pressable
                      key={r.id}
                      onPress={() => toggle(r.id)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      className={`min-h-[52px] flex-row items-center py-3 active:opacity-70 ${i > 0 ? 'border-t border-border' : ''}`}
                    >
                      <View className="flex-1">
                        <Text className="text-fg text-base font-semibold" numberOfLines={1}>
                          {r.name}
                        </Text>
                        <Text className="text-muted text-xs mt-0.5">{r.exerciseCount} egzersiz</Text>
                      </View>
                      <View
                        className={`w-7 h-7 rounded-full items-center justify-center ${on ? 'bg-accent' : 'border-2 border-border'}`}
                      >
                        {on && <Check color={COLORS.accentFg} size={15} strokeWidth={3} />}
                      </View>
                    </Pressable>
                  );
                })}
              </Card>
              <PrimaryButton
                label={picked.length > 0 ? `Taslak oluştur (${picked.length} gün)` : 'Rutin seç'}
                disabled={picked.length === 0}
                onPress={() => {
                  const routines = picked.join(',');
                  setPicked([]);
                  onPanel(null);
                  router.push({ pathname: '/programs/edit', params: { gymId, routines, ...extra } });
                }}
              />
            </>
          )}
        </View>
      )}
    </View>
  );
}
