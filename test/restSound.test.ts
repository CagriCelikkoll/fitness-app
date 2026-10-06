/**
 * Dinlenme bitiş sesi: çalma kararı ve `app_settings.restTimerSound`
 * okuma/yazma (gerçek SQLite).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { appSettings } from '@/db/schema';
import { saveSettings } from '@/lib/appSettings';
import { MAX_REST_SOUND_LATENESS_MS, shouldPlayRestSound } from '@/lib/restSound';
import { createTestDb, type TestDb } from './helpers/testDb';

describe('shouldPlayRestSound', () => {
  const base = { enabled: true, foreground: true, remainingMs: 0 };

  it('ön planda, ayar açık, bitiş taze → çalar', () => {
    expect(shouldPlayRestSound(base)).toBe(true);
    // −15 ile hemen biten sayaç: bir sonraki tıkta, 1 sn içinde
    expect(shouldPlayRestSound({ ...base, remainingMs: -999 })).toBe(true);
  });

  it('ayar kapalıysa çalmaz', () => {
    expect(shouldPlayRestSound({ ...base, enabled: false })).toBe(false);
  });

  it('arka planda çalmaz (bildirim haber veriyor)', () => {
    expect(shouldPlayRestSound({ ...base, foreground: false })).toBe(false);
  });

  it('çoktan bitmiş sayaçta (uygulamaya geri dönüş) çalmaz', () => {
    expect(
      shouldPlayRestSound({ ...base, remainingMs: -MAX_REST_SOUND_LATENESS_MS })
    ).toBe(false);
    expect(shouldPlayRestSound({ ...base, remainingMs: -60_000 })).toBe(false);
  });
});

describe('ses ve titreşim ayarı (app_settings)', () => {
  let t: TestDb;
  let db: Db;

  beforeEach(() => {
    t = createTestDb();
    db = t.db;
  });

  afterEach(() => t.close());

  const read = async () =>
    (await db.select().from(appSettings).where(eq(appSettings.id, 1)))[0]!;

  it('varsayılan: ses ve titreşim açık', async () => {
    await saveSettings(db, {});
    const row = await read();
    expect(row.restTimerSound).toBe(true);
    expect(row.restTimerVibrate).toBe(true);
  });

  it('ses kapatılıp açılabiliyor, titreşim etkilenmiyor', async () => {
    await saveSettings(db, { restTimerSound: false });
    expect(await read()).toMatchObject({ restTimerSound: false, restTimerVibrate: true });

    await saveSettings(db, { restTimerVibrate: false });
    expect(await read()).toMatchObject({ restTimerSound: false, restTimerVibrate: false });

    await saveSettings(db, { restTimerSound: true });
    expect(await read()).toMatchObject({ restTimerSound: true, restTimerVibrate: false });
  });
});
