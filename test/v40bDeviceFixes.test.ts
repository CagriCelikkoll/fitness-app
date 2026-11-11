/** v4.0b cihaz testi geri bildirimi (6 madde) */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { COVER_POOLS, assignCovers, coverKindFor, type CoverKind } from '@/lib/coverImage';
import { groupRoutines, routineKindLabel } from '@/lib/routineCards';
import { screenTopInset } from '@/lib/safeArea';
import { DARK_COLORS, PALETTES } from '@/theme';
import { WORKOUT_TEMPLATES, templateRoutineName } from '@/lib/workoutTemplates';

const read = (file: string) => readFileSync(file, 'utf8');

interface SeedExercise {
  id: string;
  primaryMuscles: string[];
  category: string;
}
const seed = new Map((JSON.parse(read('assets/seed/exercises.json')) as SeedExercise[]).map((e) => [e.id, e]));

function dayKind(templateId: string, dayName: string): CoverKind {
  const day = WORKOUT_TEMPLATES.find((t) => t.id === templateId)!.days.find((d) => d.name === dayName)!;
  return coverKindFor(
    day.exercises.map((e) => {
      const ex = seed.get(e.exerciseId);
      if (!ex) throw new Error(`Katalogda yok: ${e.exerciseId}`);
      return { primaryMuscles: ex.primaryMuscles, category: ex.category, sets: e.sets };
    })
  );
}

const UPPER = 'Üst vücut';
const LOWER = 'Alt vücut';
const FULL = 'Full body';

/** Bütün hazır programlar, gün gün beklenen etiket */
const EXPECTED: Record<string, Record<string, string>> = {
  ppl: { İtme: UPPER, Çekme: UPPER, 'Bacak ve Karın': LOWER },
  split4: { 'Göğüs ve Triceps': UPPER, 'Sırt ve Biceps': UPPER, 'Omuz ve Karın': UPPER, Bacak: LOWER },
  'ant-post': { 'Ön zincir': FULL, 'Arka zincir': FULL },
  'ant-post-4': { 'Ön A': FULL, 'Arka A': FULL, 'Ön B': FULL, 'Arka B': FULL },
  'fb-ab': { A: FULL, B: FULL },
  'upper-lower': { 'Üst A': UPPER, 'Alt A': LOWER, 'Üst B': UPPER, 'Alt B': LOWER },
  'ul-ppl': { Üst: UPPER, Alt: LOWER, İtme: UPPER, Çekme: UPPER, Bacak: LOWER },
  'ul-fb': { 'Üst A': UPPER, 'Alt A': LOWER, 'Full body': FULL, 'Üst B': UPPER, 'Alt B': LOWER },
  split5: { Göğüs: UPPER, Sırt: UPPER, Omuz: UPPER, Bacak: LOWER, Kol: UPPER },
};

describe('1. hazır programların gün etiketleri', () => {
  it('tablo bütün program ve günleri kapsıyor', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(WORKOUT_TEMPLATES.map((t) => t.id).sort());
    for (const t of WORKOUT_TEMPLATES) {
      expect(Object.keys(EXPECTED[t.id]!).sort(), t.id).toEqual(t.days.map((d) => d.name).sort());
    }
  });

  for (const [templateId, days] of Object.entries(EXPECTED)) {
    for (const [dayName, label] of Object.entries(days)) {
      it(`${templateId} / ${dayName} → ${label}`, () => {
        expect(routineKindLabel(dayKind(templateId, dayName))).toBe(label);
      });
    }
  }

  it('ön / arka zincirin kapakları full body havuzundan, üst vücut kapağı değil', () => {
    const covers = assignCovers([
      { id: 'on', kind: dayKind('ant-post', 'Ön zincir') },
      { id: 'arka', kind: dayKind('ant-post', 'Arka zincir') },
    ]);
    expect(covers.get('on')).not.toBe(covers.get('arka'));
    const allowed = [...COVER_POOLS.full, 'rutin-ust-bench', 'alt-squat'];
    expect(allowed).toContain(covers.get('on'));
    expect(allowed).toContain(covers.get('arka'));
    expect(assignCovers([{ id: 'x', kind: dayKind('ant-post', 'Ön zincir') }]).get('x')).toBe('fullbody-farmer');
  });

  it('tek bölgeli gün kendi havuzundan seçer', () => {
    const upper = assignCovers([{ id: 'x', kind: dayKind('upper-lower', 'Üst A') }]).get('x')!;
    expect(COVER_POOLS.upper).toContain(upper);
    const lower = assignCovers([{ id: 'y', kind: dayKind('upper-lower', 'Alt A') }]).get('y')!;
    expect(COVER_POOLS.lower).toContain(lower);
  });
});

describe('2. program önekisiz ad', () => {
  const template = WORKOUT_TEMPLATES.find((t) => t.id === 'ant-post')!;
  const item = (id: string, name: string) => ({ id, name, kind: 'full' as const });
  const on = templateRoutineName(template, template.days[0]!);
  const arka = templateRoutineName(template, template.days[1]!);

  it('grupta önek gider, veritabanındaki ad aynı kalır', () => {
    const [group] = groupRoutines([item('a', on), item('b', arka)]);
    expect(group!.members.map((m) => m.displayName)).toEqual(['Ön zincir', 'Arka zincir']);
    expect(group!.members.map((m) => m.item.name)).toEqual([on, arka]);
  });

  it('aynı program iki kez eklendiyse ayırt eden sonek kalır', () => {
    const [group] = groupRoutines([item('a', `${on} (2)`), item('b', `${arka} (2)`)]);
    expect(group!.members.map((m) => m.displayName)).toEqual(['Ön zincir (2)', 'Arka zincir (2)']);
  });

  it('Rutinlerim: ad olduğu gibi, önekli görünse bile', () => {
    const groups = groupRoutines([item('a', on), item('c', 'Ev — Sabah')]);
    const own = groups.find((g) => g.key === 'own')!;
    expect(own.members.map((m) => m.displayName).sort()).toEqual([on, 'Ev — Sabah'].sort());
  });

  it('salon / hoca programı: "Program – Gün" öneki gider, adı değişmiş rutin aynı kalır', () => {
    const groups = groupRoutines([item('a', 'Güç – A · Ali Hoca'), item('b', 'Benim günüm')], {
      links: [
        { routineId: 'a', programId: 'p', dayIndex: 0 },
        { routineId: 'b', programId: 'p', dayIndex: 1 },
      ],
      programs: [{ id: 'p', name: 'Güç', payload: { days: [{}, {}] } }],
    });
    expect(groups[0]!.members.map((m) => m.displayName)).toEqual(['A · Ali Hoca', 'Benim günüm']);
  });

  it('kart ve kapak görünen adı kullanıyor', () => {
    expect(read('app/(tabs)/workout.tsx')).toContain('displayName={member.displayName}');
    expect(read('app/routine/cover/[id].tsx')).toContain('displayName={found.member.displayName}');
  });
});

describe('3. boş Rutinler', () => {
  const workout = read('app/(tabs)/workout.tsx');

  it('üst boşluk kaydırma içeriğinde, ortak üst boşluk kancasından', () => {
    expect(workout).toContain('contentContainerStyle={{ paddingTop: topInset + 12 }}');
    expect(workout).toContain('useScreenTopInset()');
    expect(workout).not.toContain('insets.top');
  });

  it('inset 0 gelirse durum çubuğu yüksekliği', () => {
    expect(screenTopInset(0, 24)).toBe(24);
    expect(screenTopInset(32, 24)).toBe(32);
    expect(screenTopInset(47, undefined)).toBe(47);
    expect(screenTopInset(Number.NaN, undefined)).toBe(0);
  });

  it('boş durumda iki giriş satırı gizli, kartta var', () => {
    expect(workout.match(/routineList\.length > 0 && \(\s+<Link href="\/templates(\/recommend)?" asChild>/g)).toHaveLength(2);
    const card = read('src/components/ChooseProgramCard.tsx');
    expect(card).toContain('label="Bana program öner"');
    expect(card).toContain('label="Hazır programlar"');
  });
});

describe('4. hareket detayı görseli', () => {
  const content = read('src/components/ExerciseDetailContent.tsx');
  const detail = read('app/exercise/[id].tsx');

  it('görsel koyu kartı dolduruyor, açık zemin yok', () => {
    expect(content).not.toContain('contentFit="contain"');
    expect(content).not.toContain('contentFit={');
    expect(content).not.toContain('EXERCISE_IMAGE_SURFACE');
    expect(detail).toMatch(/<DarkSurface className="px-4">\s+<ExerciseImages urls=\{imageUrls\} \/>/);
    expect(content).toContain('rounded-3xl overflow-hidden active:opacity-80');
  });

  it('geri düğmesi koyu yarı saydam daire', () => {
    expect(detail).toContain('className="bg-bg/70"');
    expect(detail).toContain('style={{ borderRadius: BACK_BUTTON_RADIUS }}');
    expect(detail).toContain('BACK_BUTTON_RADIUS = 22');
    expect(detail.indexOf('<DarkSurface>')).toBeLessThan(detail.indexOf('accessibilityLabel="Geri"'));
  });

  it('sekmenin altında tekrar eden başlık yok; panel ve seçicide duruyor', () => {
    expect(detail).toContain('<ExerciseHowTo exercise={exercise} showTitle={false} />');
    expect(content).toContain('<ExerciseHowTo exercise={exercise} />');
    expect(content).toContain('{showTitle && <SectionHeader title="Nasıl Yapılır"');
  });
});

describe('5. dolu düğmelerde yazı', () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return sourceFiles(full);
      return full.endsWith('.tsx') ? [full] : [];
    });
  }

  it('yazı rengi #08080A, iki temada', () => {
    expect(DARK_COLORS.accentFg).toBe('#08080A');
    expect(PALETTES.dark.bg).toBe('#08080A');
    expect(PALETTES.dark.prFg).toBe('#08080A');
    expect(PALETTES.light.successFg).toBe('#08080A');
    expect(read('src/theme.ts')).not.toContain('#0A0A0B');
  });

  it('PrimaryButton: rengi satır içinde, kalın', () => {
    const buttons = read('src/components/ui/Buttons.tsx');
    expect(buttons).toContain("text: 'text-accent-fg', iconColor: COLORS.accentFg, textColor: COLORS.accentFg");
    expect(buttons).toContain("font-bold ${t.text}");
  });

  it('dolgu üstündeki bütün yazılar SemiBold ya da daha kalın', () => {
    for (const file of [...sourceFiles('app'), ...sourceFiles('src/components')]) {
      if (/Buttons\.tsx$|StatTile\.tsx$/.test(file)) continue;
      const text = read(file);
      for (const match of text.matchAll(/text-accent-fg/g)) {
        const around = text.slice(Math.max(0, match.index - 120), match.index + 50);
        expect(around, `${file}: ${match.index}`).toMatch(/font-(semibold|bold|display)/);
      }
    }
  });
});

describe('6. SIRADAKİ kartı', () => {
  it('hareket adı en fazla 2 satır', () => {
    const rest = read('src/components/RestScreen.tsx');
    const card = rest.slice(rest.indexOf('function NextCard'));
    expect(card).toMatch(/numberOfLines=\{2\}>\s+\{next\.name\}/);
  });
});
