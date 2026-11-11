/**
 * Profil sekmesi (v4.0a Bölüm 5) — ayar grupları ve üst bilgi, saf.
 *
 * Eski Ayarlar sekmesinin bütün bölümleri bu satırlardan açılan alt
 * sayfalarda (`app/settings/[group].tsx`); hiçbir ayar kaybolmadı:
 *
 * | Satır                      | Bölümler                                            |
 * |----------------------------|-----------------------------------------------------|
 * | Görünüm                    | Tema, salon rengi                                   |
 * | Vücut bilgileri            | Boy, doğum tarihi, cinsiyet (eski "Profil")         |
 * | Birimler ve dinlenme       | Birimler; dinlenme süresi, haftalık hedef, ses,     |
 * |                            | titreşim, ilerleme önerileri                        |
 * | Bildirimler                | Dinlenme bildirimi, salon duyuruları, ders değişik. |
 * | Yedekleme ve dışa aktarma  | Yedek al / paylaş / geri yükle, yarım antrenmanlar  |
 * | Gizlilik ve hesap          | Hesap ve salon (e-posta, ad, salon araçları,        |
 * |                            | eşitleme, çıkış, hesap silme), gizlilik, sıfırlama  |
 * | Hakkında                   | Sürüm, sayılar, tanıtımı tekrar göster              |
 */

import { upperTr } from '@/lib/typography';

export const SETTINGS_GROUPS = [
  { key: 'appearance', title: 'Görünüm' },
  { key: 'body', title: 'Vücut bilgileri' },
  { key: 'training', title: 'Birimler ve dinlenme' },
  { key: 'notifications', title: 'Bildirimler' },
  { key: 'data', title: 'Yedekleme ve dışa aktarma' },
  { key: 'account', title: 'Gizlilik ve hesap' },
  { key: 'about', title: 'Hakkında' },
] as const;

export type SettingsGroupKey = (typeof SETTINGS_GROUPS)[number]['key'];

export function isSettingsGroup(value: unknown): value is SettingsGroupKey {
  return typeof value === 'string' && SETTINGS_GROUPS.some((g) => g.key === value);
}

export function settingsGroupTitle(key: SettingsGroupKey): string {
  return SETTINGS_GROUPS.find((g) => g.key === key)!.title;
}

/** Avatarın harfi: adın ilk harfi, Türkçe büyük ("ç" → "Ç", "i" → "İ"); ad yoksa null */
export function avatarInitial(name: string | null | undefined): string | null {
  const first = name?.trim().charAt(0);
  return first ? upperTr(first) : null;
}

/** Saniye → "1:30" (dinlenme süresi satırı) */
export function restClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Adın altındaki eşitleme satırı. Hesapsız: verinin nerede olduğu. Hesaplı:
 * eşitleme kartının cümlesi ("Eşitlendi · 2 dk önce" → "Yedeklendi · 2 dk
 * önce"); soru bekliyorsa ona yönlendirir.
 */
export function profileSyncLine(
  signedIn: boolean,
  view: { kind: 'status'; text: string; tone: 'ok' | 'muted' | 'danger' } | { kind: 'owner_mismatch' | 'confirm' }
): { text: string; tone: 'ok' | 'muted' | 'danger' } {
  if (!signedIn) return { text: 'Hesapsız — veriler bu telefonda', tone: 'muted' };
  if (view.kind !== 'status') return { text: 'Eşitleme yanıt bekliyor · Gizlilik ve hesap', tone: 'danger' };
  return { text: view.text.replace(/^Eşitlendi\b/, 'Yedeklendi'), tone: view.tone };
}
