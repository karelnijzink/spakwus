// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { getSegment } from "@nissegroup/shared";
import type { CommunityPost } from "../lib/supabaseCommunity.js";
import { categoryGlyph, categoryLabel, KIND_ACCENT, KIND_LABEL, KIND_PILL } from "../lib/community.js";
import { timeAgo } from "../lib/time.js";

export function CommunityPostCard({ post }: { post: CommunityPost }) {
  const location = getSegment(post.segment_id)?.name ?? post.segment_id;
  return (
    <article className={`rounded-2xl border border-edge border-l-[3px] bg-paper-raised p-4 ${KIND_ACCENT[post.kind]}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${KIND_PILL[post.kind]}`}>
            {KIND_LABEL[post.kind]}
          </span>
          <span className="text-xs text-ink-2">
            <span aria-hidden>{categoryGlyph(post.category)}</span> {categoryLabel(post.category)}
          </span>
        </div>
        <span className="text-[11px] text-ink-3">{timeAgo(post.created_at)}</span>
      </div>

      <p className="mt-2 text-[15px] leading-relaxed text-ink">{post.body}</p>
      <p className="mt-1 text-xs text-ink-3">
        {location}
        {post.contact_method === "phone" && post.contact_value ? (
          <>
            {" · "}
            <a href={`tel:${post.contact_value.replace(/[^\d+]/g, "")}`} className="text-community underline">
              <span aria-hidden>📞</span> {post.contact_value}
            </a>
          </>
        ) : (
          ""
        )}
      </p>
    </article>
  );
}
