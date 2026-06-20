import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--ui-accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--ui-border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        // Redwood named tokens
        brand:        "var(--brand)",
        "accent-teal": "var(--accent)",
        // AskERP Workbench palette (Redwood)
        wb: {
          page:     "var(--bg-page)",
          surface:  "var(--bg-surface)",
          subtle:   "var(--bg-subtle)",
          accent:   "var(--bg-subtle)",
          divider:  "var(--border)",
          primary:  "var(--text-primary)",
          secondary:"var(--text-secondary)",
          tertiary: "var(--text-tertiary)",
          teal:     "var(--accent)",
          "teal-hover": "var(--accent-hover)",
          positive: "var(--sentiment-positive)",
          negative: "var(--sentiment-negative)",
          neutral:  "var(--sentiment-neutral)",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [],
};

export default config;
