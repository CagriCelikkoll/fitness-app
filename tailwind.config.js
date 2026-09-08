/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Gym/fitness teması — koyu lacivert arka plan, vurgu olarak yeşil/turuncu
        bg: {
          DEFAULT: '#0f172a', // koyu arka plan
          surface: '#1e293b', // kart yüzeyi
          elevated: '#334155', // hover/pressed
        },
        accent: {
          DEFAULT: '#22c55e', // PR rengi (yeşil)
          warm: '#f97316', // cardio (turuncu)
        },
        muted: '#64748b',
      },
    },
  },
  plugins: [],
};
