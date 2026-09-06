import type { Config } from "tailwindcss";

const rgb = (v: string) => `rgb(var(${v}) / <alpha-value>)`;

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: rgb("--surface"),
          raised: rgb("--surface-raised"),
          overlay: rgb("--surface-overlay"),
          border: rgb("--surface-border"),
        },
        brand: {
          DEFAULT: rgb("--brand"),
          hover: rgb("--brand-hover"),
          soft: rgb("--brand-soft"),
        },
        accent2: rgb("--accent-2"),
        ink: {
          DEFAULT: rgb("--ink"),
          muted: rgb("--ink-muted"),
          faint: rgb("--ink-faint"),
        },
        bubble: rgb("--bubble-them"),
        online: rgb("--online"),
        danger: rgb("--danger"),
        warn: rgb("--warn"),
      },
      fontFamily: {
        sans: [
          "var(--font-sans)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "typing-bounce": {
          "0%, 80%, 100%": { transform: "translateY(0)", opacity: "0.4" },
          "40%": { transform: "translateY(-4px)", opacity: "1" },
        },
        "pulse-ring": {
          "0%": { boxShadow: "0 0 0 0 rgb(var(--online) / 0.5)" },
          "70%": { boxShadow: "0 0 0 6px rgb(var(--online) / 0)" },
          "100%": { boxShadow: "0 0 0 0 rgb(var(--online) / 0)" },
        },
        "highlight-fade": {
          "0%": { backgroundColor: "rgb(var(--brand) / 0.18)" },
          "100%": { backgroundColor: "rgb(var(--brand) / 0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.18s ease-out",
        "typing-bounce": "typing-bounce 1.2s infinite ease-in-out",
        "pulse-ring": "pulse-ring 2s infinite",
        "highlight-fade": "highlight-fade 1.6s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
