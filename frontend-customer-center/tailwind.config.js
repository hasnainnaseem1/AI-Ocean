/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html"
  ],
  theme: {
    extend: {
      colors: {
        purple: {
          600: '#7C3AED',
          700: '#6D28D9',
        },
        blue: {
          500: '#3B82F6',
          600: '#2563EB',
        }
      }
    },
  },
  plugins: [],
}