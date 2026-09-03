/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}', './public/index.html'],
  theme: {
    extend: {
      colors: {
        // Manch palette: navy carries the institution, amber is the stage
        // light, cream is paper.
        navy: {
          900: '#0A2550',
          800: '#12386E',
          700: '#1A4784',
          500: '#2C63AE',
        },
        amber: {
          DEFAULT: '#F0A22B',
          700: '#C97A12',
        },
        cream: {
          DEFAULT: '#F6F1E5',
          200: '#EFE8D8',
        },
        ink: {
          DEFAULT: '#152232',
          2: '#3C4A5C',
        },
        live: '#CE3A2B',
        ok: '#1B7F58',
      },
      fontFamily: {
        sans: ['"IBM Plex Sans Devanagari"', 'Segoe UI', 'system-ui', 'sans-serif'],
        read: ['"Noto Serif Devanagari"', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
};
