import { createContext, forwardRef, useContext } from 'react';
import {
  StyleSheet,
  Text as RNText,
  TextInput as RNTextInput,
  type TextInputProps,
  type TextProps,
} from 'react-native';

import { FONT_FAMILIES, resolveFontFamily, type FontFamily } from '@/lib/typography';

/**
 * Uygulamanın metin bileşenleri (v4.0a 1.4): React Native'in `Text` /
 * `TextInput`'u + Archivo. Ekranlar `react-native`'den değil buradan
 * içe aktarır (`test/typography.test.ts` tarıyor).
 *
 * Ağırlık sınıfı (`font-semibold` …) ya da stildeki `fontWeight` ilgili
 * dosyaya çevrilir, `fontWeight` normal kalır (Android'de sahte kalınlık
 * olmasın). `font-display`: geniş başlık / dev rakam, rakamlar tabular.
 * İç içe metin dıştakinin ailesini alır (kendi sınıfı yoksa).
 */

const InheritedFont = createContext<FontFamily | null>(null);

const DISPLAY_EXTRA = { fontVariant: ['tabular-nums' as const] };

function fontStyle(className: string | undefined, style: TextProps['style'], inherited: FontFamily | null) {
  const flat = StyleSheet.flatten(style) ?? {};
  const fontFamily = resolveFontFamily({
    className,
    styleWeight: flat.fontWeight ?? null,
    styleFamily: flat.fontFamily ?? null,
    inherited,
  });
  return {
    fontFamily,
    extra: [{ fontFamily, fontWeight: 'normal' as const }, fontFamily === FONT_FAMILIES.display ? DISPLAY_EXTRA : null],
  };
}

export const Text = forwardRef<RNText, TextProps>(function Text({ className, style, ...rest }, ref) {
  const inherited = useContext(InheritedFont);
  const { fontFamily, extra } = fontStyle(className, style, inherited);
  return (
    <InheritedFont.Provider value={fontFamily as FontFamily}>
      <RNText ref={ref} className={className} style={[style, ...extra]} {...rest} />
    </InheritedFont.Provider>
  );
});

/** `useRef<TextInput>` için (react-native'deki gibi hem değer hem tür) */
export type TextInput = RNTextInput;
export type Text = RNText;

export const TextInput = forwardRef<RNTextInput, TextInputProps>(function TextInput(
  { className, style, ...rest },
  ref
) {
  const { extra } = fontStyle(className, style as TextProps['style'], null);
  return <RNTextInput ref={ref} className={className} style={[style, ...extra]} {...rest} />;
});
