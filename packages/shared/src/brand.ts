// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

/**
 * Brand configuration for Spakwus.
 *
 * Everything user-facing (page titles, footers, theme colours, emails, the PWA
 * manifest, etc.) MUST read from this module rather than hard-coding strings or
 * colours. That keeps a single source of truth for the product identity and for
 * Nisse Group Ltd ownership.
 *
 * NOTE: Colour and logo values below are intentionally left as clearly marked
 * TODO placeholders. Replace them once the visual identity is finalized. Do not
 * ship the placeholders to production without owner sign-off.
 */

export interface BrandColors {
  /** TODO: replace placeholder — primary brand colour (hex). */
  primary: string;
  /** TODO: replace placeholder — secondary/accent brand colour (hex). */
  secondary: string;
  /** TODO: replace placeholder — PWA/browser theme colour (hex). */
  theme: string;
}

export interface BrandConfig {
  /** Product name shown to users. */
  productName: string;
  /** Short tagline describing the product. */
  tagline: string;
  /** Legal publisher / owner of the product. */
  publisher: string;
  /** Public website for the publisher. */
  publisherUrl: string;
  /** Support / contact email address. */
  supportEmail: string;
  /** Path (relative to the web root) to the brand logo asset. */
  logoPath: string;
  /** Brand colours. */
  colors: BrandColors;
}

export const brand: BrandConfig = {
  productName: "Spakwus",
  tagline: "Sea to Sky Highway (BC Highway 99) live conditions & community board",
  publisher: "Nisse Group Ltd",
  publisherUrl: "https://nissegroup.com",
  supportEmail: "support@nissegroup.com",

  // TODO: replace placeholder logo path with the final asset location.
  logoPath: "/brand/logo.svg", // TODO: placeholder

  colors: {
    // Nisse Group house palette: deep pine green accent, warm terracotta second.
    primary: "#2e4a38", // pine green — primary brand accent
    secondary: "#a0392a", // terracotta — secondary accent
    theme: "#2e4a38", // PWA theme colour
  },
};

/** Convenience helper for building `<title>`-style strings from the brand. */
export function brandTitle(pageTitle?: string): string {
  return pageTitle ? `${pageTitle} · ${brand.productName}` : brand.productName;
}

/** Copyright line for footers, generated from the brand config. */
export function copyrightLine(year: number): string {
  return `© ${year} ${brand.publisher}`;
}
