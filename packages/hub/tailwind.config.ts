// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import type { Config } from "tailwindcss";

/**
 * Spakwus / Nisse Group house style. The pine accent is fed from the shared
 * brand config at runtime (via CSS variable); the paper, ink and status tokens
 * are the fixed design system.
 */
const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // Clean sans throughout (no display serif).
        display: ['"Inter Variable"', "system-ui", "sans-serif"],
        sans: ['"Inter Variable"', "system-ui", "sans-serif"],
      },
      colors: {
        paper: "#f3efe5",
        "paper-raised": "#fbf9f3",
        edge: "#e4ddce",
        ink: {
          DEFAULT: "#23221e",
          2: "#56534a",
          3: "#696558", // AA-contrast meta text (was #8b877a, ~3:1)
        },
        // Brand accent from the shared config (see brandTheme.ts).
        pine: "var(--brand-primary)",
        terracotta: "var(--brand-secondary)",
        // Status palette.
        open: { DEFAULT: "#2f5d46", bg: "#e6ece2" },
        partial: { DEFAULT: "#97671b", bg: "#f2e8cf" },
        closed: { DEFAULT: "#a0392a", bg: "#f0ddd5" },
        // Community plane — a distinct steel-blue, deliberately not a status colour.
        community: { DEFAULT: "#38566e", soft: "#5b7a94", bg: "#e9eef2" },
      },
      letterSpacing: {
        eyebrow: "0.18em",
      },
      maxWidth: {
        content: "48rem",
        app: "64rem",
      },
    },
  },
  plugins: [],
};

export default config;
