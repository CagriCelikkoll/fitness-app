/** @type {import('tailwindcss').Config} */

// v3.5: renkler CSS değişkenlerinden. Değerler src/theme.ts'te (tek kaynak);
// kökte `vars(cssVariables(...))` ile veriliyor, global.css'te koyu tema
// varsayılanı. Biçim "R G B" ki `bg-accent/10` gibi saydamlık çalışsın.
const v = (name) => `rgb(var(--color-${name}) / <alpha-value>)`;

const colors = {
  bg: {
    DEFAULT: v('bg'), // zemin
    surface: v('surface'), // kart
    elevated: v('elevated'), // kart içi, input, basılı durum
  },
  fg: v('text'), // metin (eski text-white)
  muted: v('muted'), // ikincil metin
  border: v('border'),
  accent: {
    DEFAULT: v('accent'), // vurgu DOLGUSU (bg-accent)
    fg: v('accent-fg'), // dolgu üstündeki metin
    ink: v('accent-ink'), // zemin üstünde vurgu metni / kenarlığı
    warm: v('warning'), // kardiyo
  },
  warm: v('warning'),
  warning: v('warning'),
  danger: { DEFAULT: v('danger'), fg: v('danger-fg') },
  success: { DEFAULT: v('success'), fg: v('success-fg') },
  pr: { DEFAULT: v('pr'), fg: v('pr-fg') },
};

// `text-accent` ve `border-accent` zemin üstünde okunmalı: açık temada
// limon değil koyu ton (ink). `bg-accent` dolgu olarak kalıyor.
const withInkAccent = { ...colors, accent: { ...colors.accent, DEFAULT: v('accent-ink') } };

module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors,
      textColor: withInkAccent,
      borderColor: withInkAccent,
    },
  },
  plugins: [],
};
