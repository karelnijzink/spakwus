// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

//
// The community board's shared store. A static site has no server of its own, so
// posts live in a Supabase (hosted Postgres) table and are read/written directly
// from the browser via Supabase's PostgREST API. The publishable key below is a
// PUBLIC key by design — it's safe to ship in the bundle; row-level-security on
// the table is what actually protects the data (anon may read open posts and
// insert valid ones; nothing else). Override with VITE_SUPABASE_URL /
// VITE_SUPABASE_KEY at build time if you point it at a different project.
//

import type { RequestCategory, RequestKind } from "../api/types.js";
import type { ContactMethod } from "../api/types.js";
import type { SegmentId } from "@nissegroup/shared";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "https://wwuyhcvxqxmagulykvsp.supabase.co";
const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_KEY ?? "sb_publishable_4mDvExCBQA-95SQijulZ3g_KLYFjQU7";

const REST = `${SUPABASE_URL}/rest/v1/spakwus_community_posts`;
const authHeaders = { apikey: SUPABASE_KEY, authorization: `Bearer ${SUPABASE_KEY}` };

/** Whether a community store is configured (so the board can be shown). */
export const COMMUNITY_ENABLED = Boolean(SUPABASE_URL && SUPABASE_KEY);

export interface CommunityPost {
  id: string;
  kind: RequestKind;
  category: RequestCategory;
  segment_id: SegmentId;
  body: string;
  contact_method: ContactMethod;
  contact_value: string | null;
  created_at: string;
  expires_at: string;
}

export interface NewPost {
  kind: RequestKind;
  category: RequestCategory;
  segmentId: SegmentId;
  body: string;
  contactMethod: ContactMethod;
  contactValue?: string;
}

/** Open (non-expired) posts, newest first. RLS filters out expired rows. */
export async function fetchPosts(): Promise<CommunityPost[]> {
  const res = await fetch(`${REST}?select=*&order=created_at.desc&limit=200`, { headers: authHeaders });
  if (!res.ok) throw new Error(`Community read failed: ${res.status}`);
  return (await res.json()) as CommunityPost[];
}

/** Create a post. Server-side RLS/constraints enforce the fields + 48h window. */
export async function createPost(p: NewPost): Promise<void> {
  const res = await fetch(REST, {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify({
      kind: p.kind,
      category: p.category,
      segment_id: p.segmentId,
      body: p.body.trim(),
      contact_method: p.contactMethod,
      contact_value: p.contactMethod === "phone" ? p.contactValue?.trim() || null : null,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Post failed (${res.status}) ${detail}`.trim());
  }
}
