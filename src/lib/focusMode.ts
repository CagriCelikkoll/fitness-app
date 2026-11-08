/**
 * Odak modu (v4.0a Bölüm 2) — saf durum mantığı. React ve veritabanı
 * bilmez; `app/session/active.tsx` görünüm katmanı.
 *
 * Set tamamlama, dinlenme, süperset kararı ve bitirme transaction'ı
 * değişmedi (`setCompletion.ts`, `superset.ts` `afterSetCompleted`,
 * `finishSession.ts`); buradakiler yalnızca "ekranda ne görünsün" ve
 * "dinlenmeden sonra hangi harekete geçilsin" sorularının cevabı.
 */

import { afterSetCompleted, supersetPositions, type SupersetPosition } from './superset';
import { parseRepRange } from './progression';

export interface FocusSet {
  id: string;
  setNumber: number;
  isCompleted: boolean;
}

export interface FocusExercise {
  name: string;
  supersetGroup: number | null;
  sets: FocusSet[];
}

// ── İlerleme ────────────────────────────────────────────────────────────

export interface WorkoutProgress {
  done: number;
  total: number;
  /** 0–100, tam sayı; set yoksa 0 */
  percent: number;
}

export function workoutProgress(exercises: readonly FocusExercise[]): WorkoutProgress {
  let done = 0;
  let total = 0;
  for (const ex of exercises) {
    total += ex.sets.length;
    done += ex.sets.filter((s) => s.isCompleted).length;
  }
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/**
 * Bölümlü ilerleme çizgisi: her hareket bir bölüm, değer 0–1 (tamamlanan
 * set oranı). Setsiz hareket 0. Biten hareket 1, o anki hareket set
 * oranında, kalanlar 0 — tamamlanma sırası ne olursa olsun oran.
 */
export function progressSegments(exercises: readonly FocusExercise[]): number[] {
  return exercises.map((ex) =>
    ex.sets.length === 0 ? 0 : ex.sets.filter((s) => s.isCompleted).length / ex.sets.length
  );
}

/** "24:10", bir saati geçince "1:04:10" */
export function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

/** "%40" yerine kullanılan metin: "24:10 · %40" */
export function elapsedAndPercent(elapsedSeconds: number, percent: number): string {
  return `${formatElapsed(elapsedSeconds)} · %${percent}`;
}

// ── Bu hareketin seti ───────────────────────────────────────────────────

/**
 * Odakta düzenlenen set: kullanıcının seçtiği (hâlâ varsa), yoksa ilk
 * tamamlanmamış set. Hepsi tamamsa null (hareket bitti).
 */
export function focusSetIndex(sets: readonly FocusSet[], selectedSetId: string | null): number | null {
  if (selectedSetId != null) {
    const i = sets.findIndex((s) => s.id === selectedSetId);
    if (i >= 0) return i;
  }
  const first = sets.findIndex((s) => !s.isCompleted);
  return first >= 0 ? first : null;
}

/**
 * Bilgi etiketi: "HAREKET 2 / 7 · SET 2 / 4"; süpersette
 * "SÜPERSET · A1 / A2 · SET 2 / 4". Hareket bittiyse set kısmı
 * "SET 4 / 4 ✓".
 */
export function focusLabel(input: {
  exerciseIndex: number;
  exerciseCount: number;
  setIndex: number | null;
  setCount: number;
  superset: SupersetPosition | null;
  supersetMembers?: string[];
}): string {
  const { exerciseIndex, exerciseCount, setIndex, setCount, superset, supersetMembers } = input;
  const head = superset
    ? `SÜPERSET · ${(supersetMembers ?? [superset.label]).join(' / ')}`
    : `HAREKET ${exerciseIndex + 1} / ${exerciseCount}`;
  if (setCount === 0) return head;
  const setPart = setIndex == null ? `SET ${setCount} / ${setCount} ✓` : `SET ${setIndex + 1} / ${setCount}`;
  return `${head} · ${setPart}`;
}

/** Süpersetin bütün üyelerinin etiketleri ("A1", "A2") */
export function supersetMemberLabels(positions: readonly (SupersetPosition | null)[], index: number): string[] {
  const p = positions[index];
  if (!p) return [];
  return positions.slice(p.start, p.end + 1).map((x) => x?.label ?? '');
}

// ── Sıradaki ────────────────────────────────────────────────────────────

export interface NextTarget {
  exerciseIndex: number;
  /** O hareketin sıradaki (ilk tamamlanmamış) setinin indeksi */
  setIndex: number;
}

function firstIncomplete(ex: FocusExercise | undefined, exceptId?: string): number {
  if (!ex) return -1;
  return ex.sets.findIndex((s) => !s.isCompleted && s.id !== exceptId);
}

/** Tamamlanmamış seti olan ilk hareket: önce sonrakiler, sonra öncekiler */
export function nextIncompleteExercise(exercises: readonly FocusExercise[], fromIndex: number): number | null {
  for (let i = fromIndex + 1; i < exercises.length; i += 1) if (firstIncomplete(exercises[i]) >= 0) return i;
  for (let i = 0; i < fromIndex; i += 1) if (firstIncomplete(exercises[i]) >= 0) return i;
  return null;
}

/**
 * Bu set tamamlanınca sıradaki ne (odak modunun alt satırı ve dinlenme
 * ekranının "SIRADAKİ" kartı). Süperset kararı `afterSetCompleted`'tan
 * (dinlenme kararıyla aynı kaynak). Son setse null.
 */
export function nextAfterSet(
  exercises: readonly FocusExercise[],
  exerciseIndex: number,
  setId: string
): NextTarget | null {
  const result = afterSetCompleted({
    exercises: exercises.map((e) => ({ name: e.name, supersetGroup: e.supersetGroup, sets: e.sets })),
    currentIndex: exerciseIndex,
    completedSetId: setId,
  });
  if (result.next) {
    const i = result.next.exerciseIndex;
    const s = firstIncomplete(exercises[i], setId);
    if (s >= 0) return { exerciseIndex: i, setIndex: s };
  }
  const same = firstIncomplete(exercises[exerciseIndex], setId);
  if (same >= 0) return { exerciseIndex, setIndex: same };
  // Az önce tamamlanan set başka harekette sayılmasın
  const others = exercises.map((e, i) =>
    i === exerciseIndex ? { ...e, sets: e.sets.map((x) => ({ ...x, isCompleted: true })) } : e
  );
  const next = nextIncompleteExercise(others, exerciseIndex);
  if (next == null) return null;
  return { exerciseIndex: next, setIndex: firstIncomplete(exercises[next]) };
}

/**
 * Set tamamlandıktan sonra odakta hangi hareket açılsın (dinlenme
 * bittiğinde ya da dinlenme yoksa hemen). Aynı harekette set kaldıysa
 * aynı hareket; süpersette sıradaki üye; hareket bittiyse sıradaki
 * tamamlanmamış hareket; hiçbiri yoksa yerinde kalır.
 */
export function exerciseAfterSet(exercises: readonly FocusExercise[], exerciseIndex: number, setId: string): number {
  return nextAfterSet(exercises, exerciseIndex, setId)?.exerciseIndex ?? exerciseIndex;
}

/** "Sıradaki: Set 3 · Bench press" / "Sıradaki: Barbell row" / "Son set" */
export function nextUpText(exercises: readonly FocusExercise[], exerciseIndex: number, next: NextTarget | null): string {
  if (!next) return 'Son set';
  const ex = exercises[next.exerciseIndex];
  if (!ex) return 'Son set';
  const setNo = ex.sets[next.setIndex]?.setNumber ?? next.setIndex + 1;
  return next.exerciseIndex === exerciseIndex ? `Set ${setNo} · ${ex.name}` : ex.name;
}

/** Odakta gösterilecek süperset konumları (tek hesap) */
export function focusSupersets(exercises: readonly FocusExercise[]): (SupersetPosition | null)[] {
  return supersetPositions(exercises.map((e) => e.supersetGroup));
}

// ── Bitir onayı ─────────────────────────────────────────────────────────

/**
 * "Bitir" onayı: tamamlanmamış set varsa sorulur ("Antrenmanı bitir?
 * 4 set tamamlanmadı."); hepsi bittiyse onaysız biter. Değer girilmiş
 * ama onaylanmamış setlerin sorusu (Tamamlanmış say / Sil) ayrıca, eskisi
 * gibi.
 */
export function finishConfirmation(exercises: readonly FocusExercise[]): { needed: boolean; message: string } {
  const { done, total } = workoutProgress(exercises);
  const remaining = total - done;
  return remaining > 0
    ? { needed: true, message: `${remaining} set tamamlanmadı.` }
    : { needed: false, message: 'Bütün setler tamam.' };
}

// ── Değerlerin hazır gelmesi ────────────────────────────────────────────

export interface PrefillInput {
  /** Setin kayıtlı değerleri (kullanıcının yazdığı ya da başlangıçtaki hedef ağırlık) */
  weightKg: number | null;
  reps: number | null;
  /** Aynı hareketin bu antrenmandaki bir önceki tamamlanmış seti (`earlierCompletedSet`) */
  earlier?: { weightKg: number | null; reps: number | null } | null;
  /** Geçen seferin aynı sıradaki seti */
  previous?: { weightKg: number | null; reps: number | null } | null;
  /** Rutindeki hedef */
  targetWeightKg?: number | null;
  targetReps?: string | null;
}

export interface Prefill {
  weight: string;
  reps: string;
  /** Kaynak: ekranda "Geçen sefer" / hedef ayrımı ve test için */
  weightSource: 'set' | 'earlier' | 'previous' | 'target' | 'empty';
  repsSource: 'set' | 'earlier' | 'previous' | 'target' | 'empty';
}

/**
 * Aynı hareketin bu antrenmanda, verilen setten önceki son tamamlanmış seti
 * (aynı set türünden: ısınmanın değeri asıl sete taşınmaz). Yoksa null.
 */
export function earlierCompletedSet<
  T extends { isCompleted: boolean; setType?: string | null; weightKg: number | null; reps: number | null },
>(sets: readonly T[], index: number): T | null {
  const current = sets[index];
  if (!current) return null;
  for (let i = index - 1; i >= 0; i--) {
    const s = sets[i]!;
    if (!s.isCompleted) continue;
    if ((s.setType ?? 'normal') !== (current.setType ?? 'normal')) continue;
    if (s.weightKg == null && s.reps == null) continue;
    return s;
  }
  return null;
}

/**
 * Odak modunda kutulara gelen değer: bu antrenmandaki bir önceki tamamlanmış
 * set → geçen sefer → rutindeki hedef → boş. Kullanıcı bu sette bir değer
 * yazdıysa (kayıtlıysa) o geçerli. Ağırlık başlangıçta rutin hedefinden
 * yazılıyor (`startSession.ts`); hedefe eşit kayıtlı ağırlık "yazılmış"
 * sayılmaz, önceki kaynaklar öne geçer.
 *
 * Hazır değerler veritabanına yazılmaz: dokunulmamış set bitirirken
 * "değer girilmiş ama onaylanmamış" sayılmasın. "Seti tamamla"da ekranda
 * görünen değer kaydedilir.
 */
export function prefillValues(input: PrefillInput): Prefill {
  const { weightKg, reps, earlier, previous, targetWeightKg, targetReps } = input;

  let weight: string;
  let weightSource: Prefill['weightSource'];
  const typedWeight = weightKg != null && (targetWeightKg == null || weightKg !== targetWeightKg);
  if (typedWeight) {
    weight = String(weightKg);
    weightSource = 'set';
  } else if (earlier?.weightKg != null) {
    weight = String(earlier.weightKg);
    weightSource = 'earlier';
  } else if (previous?.weightKg != null) {
    weight = String(previous.weightKg);
    weightSource = 'previous';
  } else if (targetWeightKg != null) {
    weight = String(targetWeightKg);
    weightSource = 'target';
  } else {
    weight = '';
    weightSource = 'empty';
  }

  let repsText: string;
  let repsSource: Prefill['repsSource'];
  const range = parseRepRange(targetReps);
  if (reps != null) {
    repsText = String(reps);
    repsSource = 'set';
  } else if (earlier?.reps != null) {
    repsText = String(earlier.reps);
    repsSource = 'earlier';
  } else if (previous?.reps != null) {
    repsText = String(previous.reps);
    repsSource = 'previous';
  } else if (range) {
    repsText = String(range.lower);
    repsSource = 'target';
  } else {
    repsText = '';
    repsSource = 'empty';
  }

  return { weight, reps: repsText, weightSource, repsSource };
}

// ── Ayar düğmeleri ──────────────────────────────────────────────────────

/** kg için 2,5; lbs için 5 */
export function weightStep(unit: string | null | undefined): number {
  return unit === 'lbs' ? 5 : 2.5;
}

/** Metin değerine ± adım; boşsa 0'dan; 0'ın altına inmez; en fazla 2 ondalık */
export function stepWeight(value: string, delta: number): string {
  const n = parseFloat(value.replace(',', '.'));
  const base = Number.isFinite(n) ? n : 0;
  const next = Math.max(0, Math.round((base + delta) * 100) / 100);
  return String(next);
}

export function stepReps(value: string, delta: number): string {
  const n = parseInt(value, 10);
  const base = Number.isFinite(n) ? n : 0;
  return String(Math.max(0, base + delta));
}

/** "70 × 8"; değer yoksa "—" */
export function setValueText(weight: string | number | null | undefined, reps: string | number | null | undefined): string {
  const w = weight == null || weight === '' ? null : String(weight);
  const r = reps == null || reps === '' ? null : String(reps);
  if (w == null && r == null) return '—';
  return `${w ?? '–'} × ${r ?? '–'}`;
}

/** Ekran okuyucu: "Ağırlık: 70 kilogram" / "Tekrar: 8" */
export function weightA11yLabel(weight: string, unit: string | null | undefined): string {
  const u = unit === 'lbs' ? 'libre' : 'kilogram';
  return weight === '' ? 'Ağırlık: boş' : `Ağırlık: ${weight.replace('.', ',')} ${u}`;
}

export function repsA11yLabel(reps: string): string {
  return reps === '' ? 'Tekrar: boş' : `Tekrar: ${reps}`;
}
