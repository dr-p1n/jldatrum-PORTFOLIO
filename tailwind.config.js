/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./pages/**/*.html"
  ],
  theme: {
    extend: {
      colors: {
        // Dark charcoal background
        background: '#1A1A1A',
        // Off-white text
        text: '#F5F5F5',
        // Teal primary (for subtle highlights, borders, hover states)
        primary: {
          DEFAULT: '#497174',
          50: '#f0f4f4',
          100: '#d9e4e5',
          200: '#b3c9cb',
          300: '#8daeb1',
          400: '#679397',
          500: '#497174',
          600: '#3a5a5d',
          700: '#2c4446',
          800: '#1d2d2e',
          900: '#0f1717',
        },
        // Coral-orange accent (for CTAs, emphasis)
        accent: {
          DEFAULT: '#FF6B35',
          50: '#fff3f0',
          100: '#ffe0d9',
          200: '#ffc1b3',
          300: '#ffa18d',
          400: '#ff8267',
          500: '#FF6B35',
          600: '#e64a27',
          700: '#b8381e',
          800: '#892815',
          900: '#5a180c',
        },
        // Borders/dividers (slightly lighter than background)
        border: '#2A2A2A',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      spacing: {
        '18': '4.5rem',
        '22': '5.5rem',
      },
      borderRadius: {
        '4xl': '2rem',
        '5xl': '2.5rem',
        '6xl': '3rem',
      },
      boxShadow: {
        'primary': '0 25px 50px -12px rgba(73, 113, 116, 0.25)',
        'accent': '0 25px 50px -12px rgba(255, 107, 53, 0.25)',
      },
      backdropBlur: {
        xs: '2px',
      },
      letterSpacing: {
        'tighter': '-0.02em',
      },
    },
  },
  plugins: [],
}