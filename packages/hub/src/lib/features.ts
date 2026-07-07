// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

/**
 * Whether a Spakwus backend (@nissegroup/core) is wired up. The public read path
 * (status, incidents, cams) always runs live from DriveBC's Open511 feed in the
 * browser, so the app works with no backend at all. Features that genuinely need
 * a server — the community board, public reporting, moderation, and the
 * backend-health / incident-history pages — are shown only when a backend URL is
 * configured at build time via VITE_API_BASE.
 */
export const HAS_BACKEND = Boolean(import.meta.env.VITE_API_BASE);

// The community board runs on a Supabase table read/written from the browser, so
// it works with no core backend. Shown whenever that store is configured.
export { COMMUNITY_ENABLED as HAS_COMMUNITY } from "./supabaseCommunity.js";
