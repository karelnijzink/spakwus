// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { brand } from "@nissegroup/shared";

/**
 * Push the brand colours (from the shared brand config) into CSS variables so
 * every component reads them via Tailwind's `brand.*` tokens. Also sets the
 * document title and the <meta name="theme-color"> from the same source.
 */
export function applyBrandTheme(): void {
  const root = document.documentElement;
  root.style.setProperty("--brand-primary", brand.colors.primary);
  root.style.setProperty("--brand-secondary", brand.colors.secondary);
  root.style.setProperty("--brand-theme", brand.colors.theme);

  document.title = brand.productName;

  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = brand.colors.theme;
}
