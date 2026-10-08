/**
 * Yasal metinler `docs/yasal-metinler.md` ile birebir aynı mı.
 *
 * `docs/` git'te değil; dosya olmayan klonda karşılaştırma atlanıyor.
 * LEGAL_CONTACT doldurulunca karşılaştırma yer tutucularla yapılıyor.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  BACKUP_SHARE_WARNING,
  CONSENT_WITHDRAW_PROMPT,
  HEALTH_CONSENT_TEXT,
  KVKK_NOTICE,
  LEGAL_CONTACT,
  PRIVACY_POLICY,
  parseBold,
  type LegalDocument,
} from '@/content/legal';

const MD_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../docs/yasal-metinler.md'
);
const hasMd = existsSync(MD_PATH);

const PLACEHOLDERS: [string, string][] = [
  [LEGAL_CONTACT.name, '[Ad Soyad]'],
  [LEGAL_CONTACT.email, '[iletişim e-postası]'],
  [LEGAL_CONTACT.effectiveDate, '[yürürlük tarihi]'],
];

function withPlaceholders(text: string): string {
  return PLACEHOLDERS.reduce(
    (acc, [value, placeholder]) => (value === placeholder ? acc : acc.split(value).join(placeholder)),
    text
  );
}

/** md'deki "## <başlık>" bölümünün gövdesi (sonraki --- ya da dosya sonuna kadar) */
function mdSection(md: string, heading: string): string {
  const start = md.indexOf(`## ${heading}\n`);
  if (start < 0) throw new Error(`Bölüm yok: ${heading}`);
  const body = md.slice(start + heading.length + 4);
  const end = body.indexOf('\n---');
  return (end < 0 ? body : body.slice(0, end)).trim();
}

function toMarkdown(doc: LegalDocument): string {
  return doc.blocks
    .map((b) => (b.kind === 'paragraph' ? b.text : b.items.map((i) => `- ${i}`).join('\n')))
    .join('\n\n');
}

describe.skipIf(!hasMd)('yasal metinler md ile aynı', () => {
  const md = hasMd ? readFileSync(MD_PATH, 'utf8').replace(/\r\n/g, '\n') : '';

  it('METİN 1 — Gizlilik Politikası', () => {
    expect(withPlaceholders(toMarkdown(PRIVACY_POLICY))).toBe(
      mdSection(md, 'METİN 1 — Gizlilik Politikası')
    );
  });

  it('METİN 2 — KVKK Aydınlatma Metni', () => {
    expect(withPlaceholders(toMarkdown(KVKK_NOTICE))).toBe(
      mdSection(md, 'METİN 2 — KVKK Aydınlatma Metni')
    );
  });

  it('METİN 3 — Açık Rıza', () => {
    expect(
      `**Başlık:** ${HEALTH_CONSENT_TEXT.title}\n\n${HEALTH_CONSENT_TEXT.body}\n\n**Onay kutusu etiketi:** ${HEALTH_CONSENT_TEXT.checkboxLabel}`
    ).toBe(mdSection(md, 'METİN 3 — Açık Rıza'));
  });

  it('METİN 4 — Kısa uyarılar', () => {
    const section = mdSection(md, 'METİN 4 — Kısa uyarılar');
    expect(section).toContain(`"${BACKUP_SHARE_WARNING}"`);
    expect(section).toContain(`Başlık: "${CONSENT_WITHDRAW_PROMPT.title}"`);
    expect(section).toContain(
      `Seçenekler: "${CONSENT_WITHDRAW_PROMPT.deleteAll}" / "${CONSENT_WITHDRAW_PROMPT.keep}" / "${CONSENT_WITHDRAW_PROMPT.cancel}"`
    );
  });
});

describe('parseBold', () => {
  it('kalın ve düz parçalar', () => {
    expect(parseBold('**Kısaca:** Girdiğin bilgiler')).toEqual([
      { text: 'Kısaca:', bold: true },
      { text: ' Girdiğin bilgiler', bold: false },
    ]);
    expect(parseBold('**7. Çocuklar**')).toEqual([{ text: '7. Çocuklar', bold: true }]);
    expect(parseBold('düz metin')).toEqual([{ text: 'düz metin', bold: false }]);
  });

  it('metinlerde kapanmamış ** kalmıyor', () => {
    for (const doc of [PRIVACY_POLICY, KVKK_NOTICE]) {
      for (const block of doc.blocks) {
        const texts = block.kind === 'paragraph' ? [block.text] : block.items;
        for (const text of texts) {
          expect(parseBold(text).some((s) => s.text.includes('**'))).toBe(false);
        }
      }
    }
  });
});
