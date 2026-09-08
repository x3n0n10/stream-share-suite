/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Only the 700/800/900/950 steps — the ones every page already
        // uses exclusively behind a dark: prefix — get pulled toward the
        // logo's near-black green-black gradient. 50-600 stay Tailwind's
        // stock slate since light mode (and dark-mode muted text) depend
        // on those steps unchanged.
        slate: {
          700: "#26402f",
          800: "#1e3229",
          900: "#101d18",
          950: "#0b1310",
        },
        accent: {
          50: "#eefdf0",
          100: "#d3fad9",
          200: "#a9f3b6",
          300: "#9bf89f",
          400: "#7bdb80",
          500: "#65c86b",
          600: "#49a850",
          700: "#357a3b",
          800: "#2a5f2f",
          900: "#204a24",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        display: [
          "Manrope",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      transitionTimingFunction: {
        "out-smooth": "cubic-bezier(0.23, 1, 0.32, 1)",
        drawer: "cubic-bezier(0.32, 0.72, 0, 1)",
      },
    },
  },
  plugins: [],
};
