/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './**/*.{ts,tsx}',
    '!./node_modules/**',
  ],
  theme: {
    extend: {
      // SQEM-547 — redesign C: Figtree for text, Bricolage Grotesque for headings (both OFL, served from
      // our own origin, imported in index.tsx). `font-display` is for headings from ~20px up only —
      // Bricolage's character is the point at size and noise at 12px.
      fontFamily: {
        sans: ['Figtree Variable', 'Figtree', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        display: ['Bricolage Grotesque Variable', 'Bricolage Grotesque', 'Figtree Variable', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      // SQEM-545 — the type scale is 2xs (10px) … 3xl, eight steps. `3xs` (9px) and `text-4xl` were
      // retired and `text-[11px]` is refused by tests/unit/designTokens.test.ts: three sizes that close
      // together read as noise, not hierarchy.
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '1rem' }],  // 10px — badge labels, uppercase tracking
      },
      // SQEM-545 — radius and elevation by ROLE. Aliases of the values already in use, so adopting one
      // changes nothing visible; what changes is that the choice now has a rule.
      // Measured, not designed: buttons and inputs are mostly `rounded-xl`, `Card` and `Modal` are
      // `rounded-2xl`, chips and small icon buttons `rounded-lg`. The roles name that.
      borderRadius: {
        chip: '0.5rem',     // = lg  — badges, tags, small icon buttons
        control: '0.75rem', // = xl  — buttons, inputs, selects, list rows
        card: '1rem',       // = 2xl — Card, panels
        overlay: '1rem',    // = 2xl — dialogs, drawers, popovers
      },
      // (boxShadow below: rest = soft, raised = lg, overlay = 2xl)
      colors: {
        // SQEM-545 — semantic tokens (values in index.css, light and dark). Prefer these to palette
        // steps: `text-ink-muted` instead of `text-slate-500 dark:text-slate-400` cannot forget dark.
        surface: {
          DEFAULT: 'rgb(var(--c-surface) / <alpha-value>)',
          raised: 'rgb(var(--c-surface-raised) / <alpha-value>)',
          sunken: 'rgb(var(--c-surface-sunken) / <alpha-value>)',
          field: 'rgb(var(--c-surface-field) / <alpha-value>)',
        },
        line: {
          DEFAULT: 'rgb(var(--c-line) / <alpha-value>)',
          strong: 'rgb(var(--c-line-strong) / <alpha-value>)',
        },
        ink: {
          strong: 'rgb(var(--c-ink-strong) / <alpha-value>)',
          DEFAULT: 'rgb(var(--c-ink) / <alpha-value>)',
          muted: 'rgb(var(--c-ink-muted) / <alpha-value>)',
          subtle: 'rgb(var(--c-ink-subtle) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--c-accent) / <alpha-value>)',
          strong: 'rgb(var(--c-accent-strong) / <alpha-value>)',
          soft: 'var(--c-accent-soft)',
        },
        danger: { DEFAULT: 'rgb(var(--c-danger) / <alpha-value>)', soft: 'var(--c-danger-soft)' },
        warning: { DEFAULT: 'rgb(var(--c-warning) / <alpha-value>)', soft: 'var(--c-warning-soft)' },
        success: { DEFAULT: 'rgb(var(--c-success) / <alpha-value>)', soft: 'var(--c-success-soft)' },
        // SQEM-547 — the skill KIND, not a status: petrol. Skills used to borrow `success` (green), so
        // "this is a skill" and "this worked" were one colour. Prompt = accent, skill = skill.
        skill: { DEFAULT: 'rgb(var(--c-skill) / <alpha-value>)', soft: 'var(--c-skill-soft)' },
        'auth-highlight': '#c8eaf5',
        brand: {
          50:  '#faf5ff',
          100: '#f3e8ff',
          200: '#e9d5ff',
          300: '#d8b4fe',
          400: '#c084fc',
          500: '#a855f7',
          600: '#9333ea',
          700: '#7e22ce',
          800: '#6b21a8',
          900: '#581c87',
          950: '#3b0764',
        },
        // SQEM-547 — the neutrals of redesign C: Tailwind's grey with a violet tint, so the whole app
        // (~3,370 `slate-*` classes) takes the new look from one place instead of 3,370 edits. Same
        // lightness steps as before, so every pairing keeps its contrast (tests/unit/darkContrast.test.ts
        // measures the text roles). The old values: 50 #f9fafb · 100 #f3f4f6 · 200 #e5e7eb ·
        // 300 #d1d5db · 600 #4b5563 · 700 #374151 · 800 #1f2937 · 900 #111827.
        slate: {
          50:  '#f8f7fb',
          100: '#f1eef6',
          200: '#e6e2ee',
          300: '#d3cede',
          // SQEM-202 — themenabhängig, siehe index.css. Nur diese beiden Werte sind
          // variabel, weil sie in hell ausschliesslich Text/Placeholder färben und dort
          // einen dunkleren, in dunkel einen helleren Ton brauchen. Nicht auf einen
          // festen Hex zurückdrehen — das bricht eines der beiden Themen.
          400: 'rgb(var(--c-slate-400) / <alpha-value>)',
          500: 'rgb(var(--c-slate-500) / <alpha-value>)',
          600: '#4a4462',
          700: '#2c2742',
          800: '#1d1932',
          900: '#141026',
        },
      },
      boxShadow: {
        'soft':    '0 2px 10px rgba(0, 0, 0, 0.03)',
        'soft-lg': '0 10px 25px rgba(0, 0, 0, 0.04)',
        rest: '0 2px 10px rgba(0, 0, 0, 0.03)',                                       // = soft
        raised: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)', // = lg
        overlay: '0 25px 50px -12px rgb(0 0 0 / 0.25)',                               // = 2xl
      },
    },
  },
  plugins: [],
};
