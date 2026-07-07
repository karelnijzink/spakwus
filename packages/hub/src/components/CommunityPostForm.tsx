// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SEGMENTS, type SegmentId } from "@nissegroup/shared";
import type { ContactMethod, RequestCategory, RequestKind } from "../api/types.js";
import { createPost } from "../lib/supabaseCommunity.js";
import { CATEGORIES, KIND_LABEL } from "../lib/community.js";

const KINDS: RequestKind[] = ["need", "offer", "info"];

export function CommunityPostForm({
  defaultSegmentId,
  onDone,
}: {
  defaultSegmentId?: SegmentId;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<RequestKind>("need");
  const [category, setCategory] = useState<RequestCategory>("welfare");
  const [segmentId, setSegmentId] = useState<SegmentId>(defaultSegmentId ?? SEGMENTS[0]!.id);
  const [body, setBody] = useState("");
  const [contactMethod, setContactMethod] = useState<ContactMethod>("in_app");
  const [phone, setPhone] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      createPost({ kind, category, segmentId, body, contactMethod, contactValue: phone }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["community-posts"] });
      onDone?.();
    },
  });

  return (
    <div className="space-y-4 rounded-2xl border border-community/20 bg-community-bg/50 p-5">
      <div role="radiogroup" aria-label="What kind of post" className="grid grid-cols-3 gap-2">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => setKind(k)}
            className={`rounded-xl border px-2 py-3 text-sm font-semibold transition ${
              kind === k ? "border-community bg-white text-community" : "border-community/20 bg-white/60 text-ink-2"
            }`}
          >
            {k === "info" ? "Share info" : KIND_LABEL[k]}
          </button>
        ))}
      </div>

      <div>
        <p id="post-category-label" className="text-sm font-medium text-ink">
          Category
        </p>
        <div role="radiogroup" aria-labelledby="post-category-label" className="mt-2 flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={category === c.value}
              onClick={() => setCategory(c.value)}
              className={`rounded-full border px-3 py-1.5 text-xs transition ${
                category === c.value
                  ? "border-community bg-white font-semibold text-community"
                  : "border-community/20 bg-white/60 text-ink-2"
              }`}
            >
              <span aria-hidden>{c.glyph}</span> {c.label}
            </button>
          ))}
        </div>
        {category === "welfare" && (
          <p className="mt-2 rounded-lg bg-white/70 px-3 py-2 text-xs text-closed">
            For a welfare check where someone may be in danger, call <strong>911</strong> (or the RCMP
            non-emergency line). Spakwus is community help, not an emergency service.
          </p>
        )}
      </div>

      <div>
        <label htmlFor="post-segment" className="text-sm font-medium text-ink">
          Where?
        </label>
        <select
          id="post-segment"
          value={segmentId}
          onChange={(e) => setSegmentId(e.target.value as SegmentId)}
          className="mt-2 w-full rounded-lg border border-community/20 bg-white px-3 py-2 text-sm text-ink"
        >
          {SEGMENTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={400}
        rows={2}
        aria-label="Your post"
        placeholder={kind === "need" ? "What do you need?" : kind === "offer" ? "What can you offer?" : "What's the info?"}
        className="w-full rounded-lg border border-community/20 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-3"
      />

      <div>
        <p id="post-contact-label" className="text-sm font-medium text-ink">
          How should people reach you?
        </p>
        <div role="radiogroup" aria-labelledby="post-contact-label" className="mt-2 flex gap-2">
          {(["in_app", "phone", "none"] as ContactMethod[]).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={contactMethod === m}
              onClick={() => setContactMethod(m)}
              className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                contactMethod === m
                  ? "border-community bg-white font-semibold text-community"
                  : "border-community/20 bg-white/60 text-ink-2"
              }`}
            >
              {m === "in_app" ? "Reply here" : m === "phone" ? "Phone" : "No contact"}
            </button>
          ))}
        </div>
        {contactMethod === "phone" && (
          <div className="mt-2">
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              aria-label="Phone number (shown publicly on the board)"
              placeholder="Phone number"
              className="w-full rounded-lg border border-community/20 bg-white px-3 py-2 text-sm text-ink"
            />
            <p className="mt-1 text-xs text-closed">⚠ This number will be shown publicly to anyone on the board.</p>
          </div>
        )}
      </div>

      {mutation.isError && (
        <p role="alert" className="text-sm text-closed">
          Couldn't post — check your connection and try again.
        </p>
      )}

      <button
        type="button"
        onClick={() => mutation.mutate()}
        disabled={body.trim().length === 0 || (contactMethod === "phone" && !phone.trim()) || mutation.isPending}
        className="w-full rounded-xl bg-community px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-40"
      >
        {mutation.isPending ? "Posting…" : "Post to the board"}
      </button>
      <p className="text-[11px] leading-relaxed text-ink-3">
        Posts are public and disappear after 48 hours. Don't share anything you wouldn't want seen by
        anyone on the corridor.
      </p>
    </div>
  );
}
