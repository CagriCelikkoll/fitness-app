/**
 * Program önerisi (v3.8): önce hedef, sonra haftalık gün; öneri
 * `programRecommendation.ts`'te. Karşılamanın 4. adımı ve Hazır
 * Programlar → "Bana program öner" ekranı aynı bileşeni kullanıyor.
 *
 * Durum `useProgramRecommender`'da: karşılamada adımlar arasında
 * gezinince seçimler kaybolmasın diye ekranda tutuluyor.
 */

import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import Storage from 'expo-sqlite/kv-store';
import { Check, Plus } from 'lucide-react-native';

import { useDb } from '@/hooks/useDb';
import { useColors } from '@/hooks/useTheme';
import { applyTemplate } from '@/lib/applyTemplate';
import {
  TRAINING_DAYS_OPTIONS,
  saveGoalForAddedTemplate,
  type TrainingDaysChoice,
} from '@/lib/onboarding';
import {
  ALTERNATIVE_TITLE,
  GOAL_OPTIONS,
  getRecommendationGoal,
  recommendProgram,
  setRecommendationGoal,
  type RecommendedProgram,
  type TrainingGoal,
} from '@/lib/programRecommendation';
import { CARD_NAME_SIZES, upperTr } from '@/lib/typography';
import { Card, Chip, DisplayName, SecondaryButton } from '@/components/ui';

export function useProgramRecommender() {
  const db = useDb();
  const [goal, setGoal] = useState<TrainingGoal | null>(null);
  const [choice, setChoice] = useState<TrainingDaysChoice | null>(null);
  const [addedTemplateIds, setAddedTemplateIds] = useState<string[]>([]);
  const [adding, setAdding] = useState<string | null>(null);

  // Hedef yalnızca öneriyi etkiler; cihazda kalır (kv-store) ve yeniden
  // açılınca hatırlanır
  useEffect(() => {
    getRecommendationGoal(Storage)
      .then((saved) => {
        if (saved) setGoal((g) => g ?? saved);
      })
      .catch((err) => console.error('[RECOMMEND] Hedef okunamadı:', err));
  }, []);

  const chooseGoal = (g: TrainingGoal) => {
    setGoal(g);
    setRecommendationGoal(Storage, g).catch((err) =>
      console.error('[RECOMMEND] Hedef kaydedilemedi:', err)
    );
  };

  const addTemplate = async (program: RecommendedProgram) => {
    if (adding) return;
    const { template } = program;
    setAdding(template.id);
    try {
      await applyTemplate(db, template);
      setAddedTemplateIds((ids) => [...ids, template.id]);
      // Hedef seçimde değil, program eklenince yazılır: önerinin haftalık
      // gün sayısı (A / B / A → 3). Hata programın eklenmesini geri
      // almasın; sadece loglanır.
      saveGoalForAddedTemplate(Storage, { dayCount: program.daysPerWeek }).catch((err) =>
        console.error('[RECOMMEND] Haftalık hedef kaydedilemedi:', err)
      );
    } catch (err) {
      console.error('[RECOMMEND] Program eklenemedi:', err);
      Alert.alert('Hata', String(err));
    } finally {
      setAdding(null);
    }
  };

  return {
    goal,
    onGoal: chooseGoal,
    choice,
    onChoose: setChoice,
    addedTemplateIds,
    adding,
    onAdd: (program: RecommendedProgram) => void addTemplate(program),
  };
}

export type ProgramRecommenderState = ReturnType<typeof useProgramRecommender>;

export function ProgramRecommender({
  goal,
  onGoal,
  choice,
  onChoose,
  addedTemplateIds,
  adding,
  onAdd,
}: ProgramRecommenderState) {
  const recommendation =
    goal != null && choice != null && choice !== 'custom'
      ? recommendProgram(goal, choice)
      : null;

  return (
    <>
      <Heading title="Hedefin ne?" />
      <View className="gap-2">
        {GOAL_OPTIONS.map((opt) => (
          <Card
            key={opt.id}
            variant={goal === opt.id ? 'outline' : 'default'}
            onPress={() => onGoal(opt.id)}
            accessibilityRole="radio"
            accessibilityState={{ selected: goal === opt.id }}
            className="gap-1"
          >
            <Text className="text-fg text-lg font-semibold tracking-tight">
              {opt.title}
            </Text>
            <Text className="text-fg text-sm">{opt.subtitle}</Text>
            <Text className="text-muted text-xs leading-5 mt-1">{opt.detail}</Text>
          </Card>
        ))}
      </View>

      {goal != null && (
        <>
          <Heading title="Haftada kaç gün antrenman yapmayı düşünüyorsun?" />
          <View className="flex-row flex-wrap gap-2">
            {TRAINING_DAYS_OPTIONS.map((opt) => (
              <Chip
                key={String(opt.value)}
                label={opt.label}
                active={choice === opt.value}
                onPress={() => onChoose(opt.value)}
              />
            ))}
          </View>
        </>
      )}

      {goal != null && choice === 'custom' && (
        <Card>
          <Text className="text-fg text-base leading-6">
            Rutinler sekmesinden kendi rutinlerini oluşturabilirsin. Hazır
            programlara da istediğin zaman oradan göz atabilirsin.
          </Text>
        </Card>
      )}

      {recommendation?.notice != null && (
        <Text className="text-muted text-sm leading-5 px-1">
          {recommendation.notice}
        </Text>
      )}

      {recommendation && (
        <RecommendationCard
          label="ÖNERİLEN PROGRAM"
          program={recommendation.main}
          added={addedTemplateIds.includes(recommendation.main.template.id)}
          adding={adding === recommendation.main.template.id}
          disabled={adding != null}
          onAdd={() => onAdd(recommendation.main)}
        />
      )}

      {recommendation?.alternative != null && (
        <RecommendationCard
          label={ALTERNATIVE_TITLE.toLocaleUpperCase('tr-TR')}
          program={recommendation.alternative}
          added={addedTemplateIds.includes(recommendation.alternative.template.id)}
          adding={adding === recommendation.alternative.template.id}
          disabled={adding != null}
          onAdd={() => onAdd(recommendation.alternative!)}
        />
      )}
    </>
  );
}

function Heading({ title }: { title: string }) {
  return (
    <Text accessibilityRole="header" className="font-display text-fg text-2xl leading-[30px] mb-2">
      {upperTr(title)}
    </Text>
  );
}

/**
 * Öneri kartı: program, haftalık sıra, "neden" satırları ve ekleme.
 * Alternatifte (bölgesel split) özet yerine "Her kas grubu haftada 1 kez ·
 * tecrübeli sporcular için" etiketi.
 */
function RecommendationCard({
  label,
  program,
  added,
  adding,
  disabled,
  onAdd,
}: {
  label: string;
  program: RecommendedProgram;
  added: boolean;
  adding: boolean;
  disabled: boolean;
  onAdd: () => void;
}) {
  const COLORS = useColors();
  const { template } = program;
  return (
    <Card className="gap-3">
      <Text className="text-muted text-xs tracking-widest">{label}</Text>
      <DisplayName inset={80} sizes={CARD_NAME_SIZES}>
        {template.name}
      </DisplayName>
      <Text className="text-fg text-sm leading-5">
        {program.daysPerWeek} gün: {program.scheduleLabel}
      </Text>
      {program.chainNote != null && (
        <Text className="text-muted text-sm leading-5">{program.chainNote}</Text>
      )}
      <View className="gap-1">
        {program.isRegionalSplit ? (
          <Text className="text-fg text-sm leading-5">{program.why}</Text>
        ) : (
          <>
            <Text className="text-fg text-sm leading-5">{program.summary}</Text>
            <Text className="text-muted text-sm leading-5">{program.why}</Text>
          </>
        )}
      </View>
      {added ? (
        <View className="flex-row items-center gap-2 mt-1">
          <Check color={COLORS.accent} size={18} strokeWidth={3} />
          <Text className="text-accent text-sm font-semibold">
            {template.dayCount} rutin Rutinler sekmesine eklendi
          </Text>
        </View>
      ) : (
        <SecondaryButton
          label="Bu programı ekle"
          icon={Plus}
          loading={adding}
          disabled={disabled}
          onPress={onAdd}
          className="mt-1"
        />
      )}
    </Card>
  );
}
