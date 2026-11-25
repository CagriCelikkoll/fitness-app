import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { shouldLeaveActiveScreen } from '../src/lib/activeSessionGuard';

/**
 * Bitir → özet akışı. Projede RN render / expo-router test ortamı yok;
 * native stack'in kapanan ekranı animasyon boyunca çizmesi burada
 * kurulamıyor. Bu yüzden kural saf fonksiyonda, ekranın onu doğru sırayla
 * kullandığı kaynaktan denetleniyor.
 */

const ACTIVE = readFileSync(join(__dirname, '..', 'app', 'session', 'active.tsx'), 'utf8');
const SUMMARY = readFileSync(join(__dirname, '..', 'app', 'session', 'summary.tsx'), 'utf8');

describe('aktif antrenman kapısı', () => {
  it('ekran antrenmanı kendisi bitirdiyse Antrenman sekmesine dönmez (özet ezilmez)', () => {
    expect(shouldLeaveActiveScreen(null, true)).toBe(false);
  });

  it('oturum başka yerden kapandıysa ya da hiç yoksa döner', () => {
    expect(shouldLeaveActiveScreen(null, false)).toBe(true);
  });

  it('oturum sürerken dönmez', () => {
    expect(shouldLeaveActiveScreen('s1', false)).toBe(false);
    expect(shouldLeaveActiveScreen('s1', true)).toBe(false);
  });
});

describe('Bitir → özet (kaynak)', () => {
  it('kapı koşulsuz router.replace yapmıyor, kuralı kullanıyor', () => {
    expect(ACTIVE).toMatch(/shouldLeaveActiveScreen\(activeSessionId, finishedHere\.current\)/);
    expect(ACTIVE).not.toMatch(/if \(!activeSessionId\) \{\s*router\.replace/);
  });

  it('bitirmede sıra: işaret → endSession → özete replace', () => {
    const body = ACTIVE.slice(ACTIVE.indexOf('const finishSession = async'));
    const mark = body.indexOf('onFinishedHere();');
    const end = body.indexOf('endSession();');
    const toSummary = body.indexOf("pathname: '/session/summary'");
    expect(mark).toBeGreaterThan(-1);
    expect(mark).toBeLessThan(end);
    expect(end).toBeLessThan(toSummary);
  });

  it("Antrenman sekmesine dönüş yalnızca kapıda ve özetin 'Kaydet ve kapat'ında", () => {
    expect(ACTIVE.match(/router\.replace\('\/\(tabs\)\/workout'\)/g)).toHaveLength(1);
    // Özette dönüş yalnızca close() içinde; açılışta kendiliğinden çağrılmıyor
    expect(SUMMARY.match(/router\.replace\(/g)).toHaveLength(1);
    expect(SUMMARY).toMatch(/const close = \(\) => \{[\s\S]*?router\.replace\('\/\(tabs\)\/workout'\);\s*\};/);
  });
});
