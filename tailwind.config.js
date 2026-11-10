/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        void: {
          950: '#04070d',
          900: '#070b14',
          850: '#0a1020',
          800: '#0d1526',
          700: '#141f36',
          600: '#1c2b47',
        },
        thermal: {
          cold: '#22d3ee',
          cool: '#38bdf8',
          warm: '#fbbf24',
          hot: '#fb923c',
          sear: '#ef4444',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        glass: '0 24px 70px -20px rgba(0, 0, 0, 0.85)',
        glow: '0 0 40px -8px rgba(56, 189, 248, 0.5)',
        'glow-hot': '0 0 44px -6px rgba(251, 146, 60, 0.55)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.9)', opacity: '0.8' },
          '70%': { transform: 'scale(1.6)', opacity: '0' },
          '100%': { transform: 'scale(1.6)', opacity: '0' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'scan-line': {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(1200%)' },
        },
        /* Subtle breathing border for the header status pill. `box-shadow` (not
           border-color) so the pill's own `transition-colors` — which animates the
           border colour on an alert change — is never fought over. `currentColor`
           lets the caller tint the halo by the pill's text colour. */
        'border-pulse': {
          '0%, 100%': {
            boxShadow: '0 0 0 0 currentColor, inset 0 0 0 0 currentColor',
          },
          '50%': {
            boxShadow:
              '0 0 0 2px color-mix(in srgb, currentColor 45%, transparent), inset 0 0 0 1px color-mix(in srgb, currentColor 28%, transparent)',
          },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.45s cubic-bezier(0.22, 1, 0.36, 1) both',
        'pulse-ring': 'pulse-ring 2.4s cubic-bezier(0.22, 1, 0.36, 1) infinite',
        shimmer: 'shimmer 2.6s linear infinite',
        'scan-line': 'scan-line 7s linear infinite',
        'border-pulse': 'border-pulse 3.2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
