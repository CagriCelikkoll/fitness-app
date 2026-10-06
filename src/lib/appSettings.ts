import { appSettings } from '@/db/schema';
import type { Db } from '@/db/client';

/** Ayar satırını (id = 1) upsert eder; satır seed'de oluşuyor ama yoksa da çalışsın */
export async function saveSettings(
  db: Db,
  values: Partial<typeof appSettings.$inferInsert>
): Promise<void> {
  const patch = { ...values, updatedAt: new Date().toISOString() };
  await db
    .insert(appSettings)
    .values({ id: 1, ...patch })
    .onConflictDoUpdate({ target: appSettings.id, set: patch });
}
