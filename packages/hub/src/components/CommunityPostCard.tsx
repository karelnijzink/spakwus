// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getSegment } from "@nissegroup/shared";
import { createReply, type CommunityPost } from "../lib/supabaseCommunity.js";
import { categoryGlyph, categoryLabel, KIND_ACCENT, KIND_LABEL, KIND_PILL } from "../lib/community.js";
import { timeAgo } from "../lib/time.js";

export function CommunityPostCard({ post }: { post: CommunityPost }) {
  const qc = useQueryClient();
  const [reply, setReply] = useState("");
  const location = getSegment(post.segment_id)?.name ?? post.segment_id;

  const respond = useMutation({
    mutationFn: () => createReply(post.id, reply),
    onSuccess: () => {
      setReply("");
      void qc.invalidateQueries({ queryKey: ["community-posts"] });
    },
  });

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

      {/* Reply thread. */}
      {post.replies.length > 0 && (
        <ul className="mt-3 space-y-2 border-l border-community/25 pl-3">
          {post.replies.map((r) => (
            <li key={r.id} className="text-sm text-ink-2">
              <span>{r.body}</span>
              <span className="ml-2 text-[11px] text-ink-3">{timeAgo(r.created_at)}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Add a reply. */}
      <div className="mt-3 flex items-center gap-2">
        <input
          type="text"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          maxLength={300}
          aria-label={`Reply to: ${post.body.slice(0, 40)}`}
          placeholder="Offer help, info, or eyes on it…"
          onKeyDown={(e) => {
            if (e.key === "Enter" && reply.trim() && !respond.isPending) respond.mutate();
          }}
          className="flex-1 rounded-lg border border-edge bg-paper px-3 py-1.5 text-sm text-ink placeholder:text-ink-3"
        />
        <button
          type="button"
          disabled={!reply.trim() || respond.isPending}
          onClick={() => respond.mutate()}
          className="rounded-lg bg-community px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
        >
          {respond.isPending ? "…" : "Reply"}
        </button>
      </div>
      {respond.isError && (
        <p role="alert" className="mt-1 text-xs text-closed">
          That didn't go through — try again.
        </p>
      )}
    </article>
  );
}
