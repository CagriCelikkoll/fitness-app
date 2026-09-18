/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      // Değerler src/theme.ts'teki COLORS ile birebir aynı olmalı
      colors: {
        bg: {
          DEFAULT: '#0A0A0B', // zemin
          surface: '#141416', // kart
          elevated: '#1E1E21', // kart içi, input, basılı durum
        },
        accent: {
          DEFAULT: '#D7FF3E', // limon vurgu
          fg: '#0A0A0B', // vurgu üstündeki metin
          warm: '#FF9A3C', // kardiyo
        },
        muted: '#8A8A90',
        border: '#2A2A2F',
        danger: '#FF5A5A',
      },
    },
  },
  plugins: [],
};
