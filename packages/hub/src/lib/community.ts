// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import type { RequestCategory, RequestKind } from "../api/types.js";

export const KIND_LABEL: Record<RequestKind, string> = {
  need: "I need",
  offer: "I can help",
  info: "Info",
};

/** Left-rule / accent colour per kind (kept distinct from status colours). */
export const KIND_ACCENT: Record<RequestKind, string> = {
  need: "border-partial",
  offer: "border-open",
  info: "border-community",
};

export const KIND_PILL: Record<RequestKind, string> = {
  need: "bg-partial-bg text-partial",
  offer: "bg-open-bg text-open",
  info: "bg-community-bg text-community",
};

export const CATEGORIES: { value: RequestCategory; label: string; glyph: string }[] = [
  { value: "welfare", label: "Welfare check", glyph: "🫶" },
  { value: "supplies", label: "Supplies", glyph: "🧴" },
  { value: "ride", label: "Ride", glyph: "🚗" },
  { value: "shelter", label: "Shelter", glyph: "🏠" },
  { value: "eyes_on", label: "Eyes on it", glyph: "👀" },
  { value: "other", label: "Other", glyph: "💬" },
];

export function categoryLabel(cat: RequestCategory | string): string {
  return CATEGORIES.find((c) => c.value === cat)?.label ?? cat;
}
export function categoryGlyph(cat: RequestCategory | string): string {
  return CATEGORIES.find((c) => c.value === cat)?.glyph ?? "💬";
}
