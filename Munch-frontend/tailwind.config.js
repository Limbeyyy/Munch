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
        // What every page is laid on. The room was already this colour and
        // the rest of the app was not, so a host moving between them
        // watched the paper change under their feet.
        page: '#F1F4F8',

        // The design's own greys. Cards are white on the page, the ones
        // nested inside them are a shade off it, and the three weights of
        // text below are the only ones the design uses.
        line: { DEFAULT: '#E5E7EB', soft: '#E7E9EF' },
        sheet: '#FCFCFC',
        head: '#101828',
        body: '#4A5565',
        subtle: '#6A7282',
        faint: '#99A1AF',
        // The tag a status wears, and the blue it is written in.
        tagbg: '#EFF6FF',
        tagink: '#1447E6',
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
