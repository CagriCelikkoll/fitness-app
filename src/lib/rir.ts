/**
 * RIR (reps in reserve, "yedekte kalan tekrar") gösterimi.
 *
 * `sets.rir` tam sayı; seçicideki "4+" 4 olarak saklanıyor, 4 ve üstü
 * hep "4+" gösteriliyor. Rekor ve 1RM hesaplarına girmiyor.
 */

/** Seçicideki değerler; son değer "4+" */
export const RIR_OPTIONS = [0, 1, 2, 3, 4] as const;
export const RIR_MAX = 4;

/** "2", "4+" */
export function rirLabel(rir: number): string {
  return rir >= RIR_MAX ? `${RIR_MAX}+` : String(rir);
}

/** "80kg × 8 @2"; RIR yoksa "80kg × 8" */
export function formatSetSummary(
  weightKg: number | null,
  reps: number | null,
  rir: number | null
): string {
  const base = `${weightKg ?? '-'}kg × ${reps ?? '-'}`;
  return rir == null ? base : `${base} @${rirLabel(rir)}`;
}
