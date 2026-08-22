import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        raised: 'var(--surface-raised)',
        line: 'var(--border)',
        grid: 'var(--grid)',
        txt: 'var(--txt)',
        txt2: 'var(--txt2)',
        txt3: 'var(--txt3)',
        accent: 'var(--accent)',
        'accent-hover': 'var(--accent-hover)',
        bar: 'var(--bar)',
        'bar-muted': 'var(--bar-muted)',
        warn: 'var(--warn)',
        danger: 'var(--danger)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      letterSpacing: {
        tightest: '-0.04em',
        tighter: '-0.03em',
      },
      maxWidth: { shell: '1280px' },
    },
  },
} satisfies Config;
