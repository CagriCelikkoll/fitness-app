import { eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { sets as setsTable } from '@/db/schema';

/**
 * Aktif antrenmanda bir setin veritabanı yazımları (v4.0a). `active.tsx`'in
 * `SetRow`'undan ayrıldı ki odak modu ve liste aynı yazımı kullansın;
 * sorgular ve sıraları önceki `toggleComplete` / `updateWeight` /
 * `updateReps` / `selectRir` ile aynı. Titreşim, dinlenme ve rekor
 * kontrolü ekranda (`useSetCompletion`).
 */

/** Tamamlamak için girdi: ağırlık ve tekrar sayı olmalı (yoksa "Eksik bilgi") */
export function parseSetInput(weight: string, reps: string): { weightKg: number; reps: number } | null {
  const weightKg = parseFloat(weight.replace(',', '.'));
  const parsedReps = parseInt(reps, 10);
  if (isNaN(weightKg) || isNaN(parsedReps)) return null;
  return { weightKg, reps: parsedReps };
}

export async function completeSetRecord(
  db: Db,
  setId: string,
  values: { weightKg: number; reps: number },
  completedAt: string = new Date().toISOString()
): Promise<void> {
  await db
    .update(setsTable)
    .set({ weightKg: values.weightKg, reps: values.reps, isCompleted: true, completedAt })
    .where(eq(setsTable.id, setId));
}

/** Geri al: değerler kalır, yalnızca onay kalkar */
export async function uncompleteSetRecord(db: Db, setId: string): Promise<void> {
  await db.update(setsTable).set({ isCompleted: false, completedAt: null }).where(eq(setsTable.id, setId));
}

/** Yazarken: ağırlık metni (boş / geçersiz → null) */
export async function saveSetWeight(db: Db, setId: string, text: string): Promise<void> {
  const parsed = parseFloat(text.replace(',', '.'));
  await db
    .update(setsTable)
    .set({ weightKg: isNaN(parsed) ? null : parsed })
    .where(eq(setsTable.id, setId));
}

export async function saveSetReps(db: Db, setId: string, text: string): Promise<void> {
  const parsed = parseInt(text, 10);
  await db
    .update(setsTable)
    .set({ reps: isNaN(parsed) ? null : parsed })
    .where(eq(setsTable.id, setId));
}

/** RIR seçimi (isteğe bağlı); null seçimi kaldırır (dinlenme ekranında ikinci dokunuş) */
export async function saveSetRir(db: Db, setId: string, rir: number | null): Promise<void> {
  await db.update(setsTable).set({ rir }).where(eq(setsTable.id, setId));
}
