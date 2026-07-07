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

export interface CommunityReply {
  id: string;
  body: string;
  created_at: string;
}

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
  replies: CommunityReply[];
}

interface PostRow extends Omit<CommunityPost, "replies"> {
  spakwus_community_replies: CommunityReply[] | null;
}

export interface NewPost {
  kind: RequestKind;
  category: RequestCategory;
  segmentId: SegmentId;
  body: string;
  contactMethod: ContactMethod;
  contactValue?: string;
}

/** Open (non-expired) posts with their replies embedded, newest first. */
export async function fetchPosts(): Promise<CommunityPost[]> {
  const select = "*,spakwus_community_replies(id,body,created_at)";
  const res = await fetch(`${REST}?select=${encodeURIComponent(select)}&order=created_at.desc&limit=200`, {
    headers: authHeaders,
  });
  if (!res.ok) throw new Error(`Community read failed: ${res.status}`);
  const rows = (await res.json()) as PostRow[];
  return rows.map(({ spakwus_community_replies, ...post }) => ({
    ...post,
    replies: (spakwus_community_replies ?? []).sort((a, b) => a.created_at.localeCompare(b.created_at)),
  }));
}

const REPLIES = `${SUPABASE_URL}/rest/v1/spakwus_community_replies`;

/** Reply to an open post. RLS enforces the parent post exists and is open. */
export async function createReply(postId: string, body: string): Promise<void> {
  const res = await fetch(REPLIES, {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify({ post_id: postId, body: body.trim() }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Reply failed (${res.status}) ${detail}`.trim());
  }
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
