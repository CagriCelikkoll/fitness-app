/**
 * Vücut ölçümlerinden türetilen metrikler — saf fonksiyonlar.
 *
 * Veritabanı veya React bilmezler; sayı alıp sayı döndürürler.
 * Geçersiz/eksik girdide hata fırlatmak yerine null döndürürler.
 */

function isPositive(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/** VKİ = kg / (m)² */
export function calculateBmi(weightKg: number, heightCm: number): number | null {
  if (!isPositive(weightKg) || !isPositive(heightCm)) return null;
  const heightM = heightCm / 100;
  return weightKg / (heightM * heightM);
}

/** Türkçe VKİ kategorisi (WHO eşikleri) */
export function bmiCategory(bmi: number): string | null {
  if (!isPositive(bmi)) return null;
  if (bmi < 18.5) return 'Zayıf';
  if (bmi < 25) return 'Normal';
  if (bmi < 30) return 'Fazla kilolu';
  return 'Obez';
}

/** Bel / boy oranı. 0.5 altı genelde sağlıklı kabul edilir. */
export function waistToHeightRatio(
  waistCm: number,
  heightCm: number
): number | null {
  if (!isPositive(waistCm) || !isPositive(heightCm)) return null;
  return waistCm / heightCm;
}

/**
 * YYYY-MM-DD doğum tarihinden bugünkü yaş.
 * `today` test için dışarıdan verilebilir.
 */
export function calculateAge(
  birthDateIso: string,
  today: Date = new Date()
): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDateIso?.trim() ?? '');
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // 2026-02-31 gibi takvimde olmayan tarihleri ele
  const birth = new Date(year, month - 1, day);
  if (
    birth.getFullYear() !== year ||
    birth.getMonth() !== month - 1 ||
    birth.getDate() !== day
  ) {
    return null;
  }

  let age = today.getFullYear() - year;
  const hadBirthdayThisYear =
    today.getMonth() > month - 1 ||
    (today.getMonth() === month - 1 && today.getDate() >= day);
  if (!hadBirthdayThisYear) age -= 1;

  return age >= 0 && age < 130 ? age : null;
}

/**
 * Bazal metabolizma hızı (kcal/gün), Mifflin-St Jeor.
 * Cinsiyet 'male' veya 'female' değilse tahmin etmez, null döner.
 */
export function calculateBmr(
  weightKg: number,
  heightCm: number,
  age: number,
  gender: string
): number | null {
  if (!isPositive(weightKg) || !isPositive(heightCm)) return null;
  if (typeof age !== 'number' || !Number.isFinite(age) || age < 0) return null;

  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  if (gender === 'male') return base + 5;
  if (gender === 'female') return base - 161;
  return null;
}

/** Yağsız kütle = kg × (1 − yağ% / 100) */
export function leanBodyMass(
  weightKg: number,
  bodyFatPct: number
): number | null {
  if (!isPositive(weightKg)) return null;
  if (
    typeof bodyFatPct !== 'number' ||
    !Number.isFinite(bodyFatPct) ||
    bodyFatPct < 0 ||
    bodyFatPct >= 100
  ) {
    return null;
  }
  return weightKg * (1 - bodyFatPct / 100);
}
