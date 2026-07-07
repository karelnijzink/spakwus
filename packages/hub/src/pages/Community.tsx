// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getSegment, type SegmentId } from "@nissegroup/shared";
import { useRequests } from "../api/queries.js";
import type { RequestCategory, RequestKind } from "../api/types.js";
import { CreateRequestForm } from "../components/CreateRequestForm.js";
import { RequestCard } from "../components/RequestCard.js";
import { CATEGORIES, KIND_LABEL } from "../lib/community.js";

export function Community() {
  const [params] = useSearchParams();
  const incidentId = params.get("incidentId") ?? undefined;
  const segmentId = (params.get("segmentId") as SegmentId | null) ?? undefined;
  const [creating, setCreating] = useState(false);
  const [kindFilter, setKindFilter] = useState<RequestKind | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<RequestCategory | "all">("all");

  const query = useRequests({
    ...(incidentId ? { incidentId } : {}),
    ...(segmentId ? { segmentId } : {}),
  });
  const all = query.data?.requests ?? [];
  const requests = all.filter(
    (r) => (kindFilter === "all" || r.kind === kindFilter) && (categoryFilter === "all" || r.category === categoryFilter),
  );

  const contextLabel = incidentId
    ? "for this incident"
    : segmentId
      ? getSegment(segmentId)?.name ?? "this segment"
      : "the Sea to Sky corridor";

  return (
    <div className="space-y-5">
      {/* Distinct community-plane header. */}
      <div className="rounded-2xl bg-community px-5 py-5 text-white">
        <p className="text-[11px] uppercase tracking-eyebrow text-white/70">Community board</p>
        <h1 className="mt-1 font-display text-2xl">Help each other through it</h1>
        <p className="mt-1 text-sm text-white/85">
          Needs and offers {contextLabel}. This is community help — <strong>separate from road status</strong>. Posts
          here never change the status.
        </p>
      </div>

      {/* Persistent safety line. */}
      <p className="rounded-xl border border-closed/30 bg-closed-bg/60 px-4 py-3 text-sm font-medium text-closed">
        For emergencies call <strong>911</strong>. Spakwus is community help, not an emergency service.
      </p>

      <div className="flex items-center justify-between">
        <div className="flex flex-wrap gap-1.5">
          {(["all", "need", "offer", "info"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKindFilter(k)}
              className={`rounded-full px-3 py-1 text-xs transition ${
                kindFilter === k ? "bg-community text-white" : "bg-community-bg text-community"
              }`}
            >
              {k === "all" ? "All" : k === "info" ? "Info" : KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="rounded-full bg-community px-3 py-1.5 text-xs font-semibold text-white"
        >
          {creating ? "Close" : "＋ Post"}
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setCategoryFilter("all")}
          className={`rounded-full px-2.5 py-1 text-[11px] transition ${
            categoryFilter === "all" ? "bg-community/15 text-community" : "text-ink-3"
          }`}
        >
          All categories
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => setCategoryFilter(c.value)}
            className={`rounded-full px-2.5 py-1 text-[11px] transition ${
              categoryFilter === c.value ? "bg-community/15 text-community" : "text-ink-3"
            }`}
          >
            {c.glyph} {c.label}
          </button>
        ))}
      </div>

      {creating && (
        <CreateRequestForm defaultSegmentId={segmentId} onDone={() => setCreating(false)} />
      )}

      {requests.length === 0 ? (
        <p className="rounded-2xl border border-edge bg-paper-raised p-6 text-center text-sm text-ink-3">
          {query.isError
            ? "The community board is unavailable right now."
            : "No open requests here yet. Be the first to post a need or an offer."}
        </p>
      ) : (
        <div className="space-y-3">
          {requests.map((r) => (
            <RequestCard key={r.id} request={r} />
          ))}
        </div>
      )}
    </div>
  );
}
