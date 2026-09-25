import { describe, expect, it } from 'vitest';

import { youtubeSearchUrl } from '@/lib/youtube';

function queryOf(url: string): string | null {
  return new URL(url).searchParams.get('search_query');
}

describe('youtubeSearchUrl', () => {
  it('YouTube arama adresi, İngilizce ad + "exercise form"', () => {
    const url = youtubeSearchUrl('Barbell Squat');
    expect(url).toBe(
      'https://www.youtube.com/results?search_query=Barbell%20Squat%20exercise%20form'
    );
  });

  it('tire ve boşluklu ad doğru kodlanıyor', () => {
    const url = youtubeSearchUrl('Barbell Bench Press - Medium Grip');
    expect(url).not.toMatch(/\s/);
    expect(queryOf(url)).toBe('Barbell Bench Press - Medium Grip exercise form');
  });

  it('özel karakterler (&, /, parantez, #) sorguyu bölmüyor', () => {
    for (const name of [
      'Dips - Triceps Version',
      'Running (Outdoor)',
      'Clean & Jerk',
      'Push/Pull #2',
    ]) {
      const url = youtubeSearchUrl(name);
      const parsed = new URL(url);
      expect([...parsed.searchParams.keys()]).toEqual(['search_query']);
      expect(parsed.hash).toBe('');
      expect(queryOf(url)).toBe(`${name} exercise form`);
    }
  });
});
