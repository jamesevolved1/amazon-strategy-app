/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#0f1115',
          soft: '#1c1f26',
          mute: '#5b6068',
          faint: '#8b909a',
        },
        canvas: {
          DEFAULT: '#f6f7f9',
          panel: '#ffffff',
          tint: '#fafbfc',
        },
        line: {
          DEFAULT: '#e7e9ee',
          strong: '#d8dbe2',
        },
        accent: {
          peri: '#9aa6f0',       // periwinkle blue
          periSoft: '#dde2ff',
          mint: '#a7d9b9',       // mint green
          mintSoft: '#daf0e2',
          gold: '#e9c875',       // soft gold
          goldSoft: '#fbeec9',
          lavender: '#c7b8e8',
          lavenderSoft: '#eee5fb',
          blush: '#f1bdc4',
          blushSoft: '#fbe1e4',
        },
        good: '#1f9d6b',
        warn: '#c98a1a',
        bad: '#c4505b',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 17, 21, 0.04), 0 1px 1px rgba(15, 17, 21, 0.02)',
        cardHover: '0 4px 14px rgba(15, 17, 21, 0.07)',
        pop: '0 8px 28px rgba(15, 17, 21, 0.10)',
      },
      borderRadius: {
        xl2: '14px',
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
    },
  },
  plugins: [],
}
