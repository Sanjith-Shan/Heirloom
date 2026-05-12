import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#0a0a0a",
        foreground: "#fafafa",
        muted: "#171717",
        "muted-foreground": "#a3a3a3",
        border: "#262626",
        accent: "#fafafa",
        "accent-foreground": "#0a0a0a",
        // Phase colors
        "phase-active": "#10b981",
        "phase-reminder": "#fbbf24",
        "phase-emergency": "#f97316",
        "phase-verification": "#a855f7",
        "phase-execution": "#ef4444",
        "phase-completed": "#404040",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "monospace"],
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
