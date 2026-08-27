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
        'line-strong': 'var(--border-strong)',
        grid: 'var(--grid)',
        txt: 'var(--txt)',
        txt2: 'var(--txt2)',
        txt3: 'var(--txt3)',
        accent: 'var(--accent)',
        'accent-hover': 'var(--accent-hover)',
        'accent-soft': 'var(--accent-soft)',
        bar: 'var(--bar)',
        'bar-muted': 'var(--bar-muted)',
        warn: 'var(--warn)',
        danger: 'var(--danger)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'Georgia', 'serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      borderRadius: { DEFAULT: '0.5rem', sm: '0.375rem', lg: '0.75rem' },
      boxShadow: { soft: 'var(--shadow-sm)', card: 'var(--shadow)' },
      letterSpacing: { tightest: '-0.03em', tighter: '-0.02em' },
      maxWidth: { shell: '1280px' },
    },
  },
} satisfies Config;
