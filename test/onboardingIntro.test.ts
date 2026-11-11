/**
 * v4.0b Bölüm 3: karşılamanın görselli üç sayfası (içerik, başlık boyutu,
 * görsel yüksekliği, korunan bağlantılar).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { COVER_GRADIENTS, SCREEN_COVERS, gradientOpacityAt } from '@/lib/coverImage';
import {
  INTRO_PAGES,
  INTRO_TEXT_OFFSET,
  INTRO_TITLE_MAX,
  introCoverHeight,
  introTitleSize,
} from '@/lib/onboardingIntro';

const ROOT = path.resolve(__dirname, '..');
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');
const EMOJI = /\p{Extended_Pictographic}/u;

describe('sayfalar', () => {
  it('üç sayfa, spec sırası ve düğmeleri', () => {
    expect(INTRO_PAGES.map((p) => p.cover)).toEqual(['karsilama', 'karsilama-2-kayit', 'karsilama-3-gelisim']);
    expect(INTRO_PAGES.map((p) => p.cta)).toEqual(['Başlayalım', 'Devam', 'Programımı seç']);
    expect(INTRO_PAGES.map((p) => p.overlay)).toEqual([null, 'set-saved', 'progress-chart']);
    for (const p of INTRO_PAGES) expect(SCREEN_COVERS).toContain(p.cover);
  });

  it('başlıklar', () => {
    expect([...INTRO_PAGES[0]!.title, ...INTRO_PAGES[0]!.accent].join(' ')).toBe('HER SET KAYITTA. HER HAFTA DAHA GÜÇLÜ.');
    expect([...INTRO_PAGES[1]!.title, ...INTRO_PAGES[1]!.accent].join(' ')).toBe('SETLER ARASINDA TEK DOKUNUŞ.');
    expect([...INTRO_PAGES[2]!.title, ...INTRO_PAGES[2]!.accent].join(' ')).toBe('GELİŞİMİNİ GÖR.');
    expect(INTRO_PAGES[2]!.body).toContain('Verilerin önce telefonunda kalır');
  });

  it('emoji yok', () => {
    for (const p of INTRO_PAGES) expect(EMOJI.test(`${p.title} ${p.accent} ${p.body} ${p.cta}`)).toBe(false);
    for (const f of ['app/onboarding.tsx', 'src/components/OnboardingIntro.tsx', 'src/components/ProgramRecommender.tsx']) {
      expect(read(f), f).not.toMatch(/💪|🏃|🔥/);
    }
  });
});

describe('başlık boyutu', () => {
  it('en geniş satır her ekranda sığar', () => {
    for (const width of [272, 312, 342, 380]) {
      for (const scale of [1, 1.3]) {
        for (const p of INTRO_PAGES) {
          const size = introTitleSize(p.widestLineEm, width, scale);
          expect(p.widestLineEm * size * scale, `${p.cover} ${width} ${scale}`).toBeLessThanOrEqual(width);
        }
      }
    }
  });

  it('geniş ekranda üst sınırda kalır', () => {
    expect(introTitleSize(7.12, 900)).toBe(INTRO_TITLE_MAX);
    expect(introTitleSize(9.09, 342)).toBe(36);
  });
});

describe('görsel yüksekliği', () => {
  it('yazının başladığı yerde karartma baskın', () => {
    expect(gradientOpacityAt(COVER_GRADIENTS.page, INTRO_TEXT_OFFSET)).toBeGreaterThanOrEqual(0.6);
    // tasarımdaki yerleşim: 844 px ekranda yazı 434'te başlıyor, görsel ~600
    expect(introCoverHeight(434)).toBe(603);
  });
});

describe('akış', () => {
  const screen = read('app/onboarding.tsx');
  const intro = read('src/components/OnboardingIntro.tsx');

  it('sonraki adımlar duruyor', () => {
    for (const piece of ['<PrivacyStep', '<ProfileStep', '<ProgramRecommender', '<TipsStep']) expect(screen).toContain(piece);
    expect(screen).toContain('<OnboardingIntro');
  });

  it('atla, sayfa göstergesi, giriş ve geri yükleme var', () => {
    for (const piece of ['pagingEnabled', '>Atla<', '<ProgressDots', 'Hesabım var, giriş yap', 'Yedeğin var mı?', 'Geri yükle']) {
      expect(intro, piece).toContain(piece);
    }
  });

  it('giriş yalnızca buradan açıldıysa akışı bitirir; hesap yoksa bağlantı yok', () => {
    expect(screen).toContain('signInOpened');
    expect(screen).toContain('accountAvailable && !userId ? openSignIn : null');
  });

  it('geri tuşu tanıtım sayfalarında da geri gider', () => {
    expect(screen).toContain('if (step === 0 && introPage === 0) return;');
  });
});
