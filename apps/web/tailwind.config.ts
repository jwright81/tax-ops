import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0b1020',
        panel: '#121a2b',
        line: '#24324d',
        text: '#f5f7fb',
        muted: '#90a3bf',
        accent: '#7c93ff'
      },
      borderRadius: {
        xl2: '1rem'
      }
    },
  },
  plugins: [],
} satisfies Config;
