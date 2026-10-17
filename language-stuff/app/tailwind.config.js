/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Warm, domestic palette — the app should feel like a lit kitchen at dusk,
        // not a language course. SPEC section 1: no shame architecture.
        cream: {
          DEFAULT: "#FDF6EC",
          deep: "#F5E9D7",
        },
        clay: {
          DEFAULT: "#C86B4A",
          dark: "#A6543A",
          light: "#E8A183",
        },
        ink: {
          DEFAULT: "#3B2E28",
          soft: "#6B5A52",
          faint: "#9C8A80",
        },
        sage: "#7C8B6F",

        // NOTE: there is deliberately no `error` or `danger` red in this palette.
        // SPEC section 10 forbids punitive feedback UI, and the fastest way to keep a
        // red X out of the app is to make one inconvenient to reach for.
      },
      fontSize: {
        // Telugu and Devanagari both need more vertical room than Latin at the same point size.
        native: ["28px", { lineHeight: "44px" }],
        "native-sm": ["20px", { lineHeight: "34px" }],
      },
    },
  },
  plugins: [],
};
