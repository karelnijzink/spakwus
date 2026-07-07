// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getSegment } from "@nissegroup/shared";
import { addResponse, flagRequest, flagResponse, patchRequest } from "../api/client.js";
import type { CommunityRequestItem } from "../api/types.js";
import { getDeviceToken } from "../lib/deviceToken.js";
import { isOwnedRequest } from "../lib/ownedRequests.js";
import { categoryGlyph, categoryLabel, KIND_ACCENT, KIND_LABEL, KIND_PILL } from "../lib/community.js";
import { timeAgo } from "../lib/time.js";

export function RequestCard({ request }: { request: CommunityRequestItem }) {
  const qc = useQueryClient();
  const [reply, setReply] = useState("");
  const owned = isOwnedRequest(request.id);
  const location = getSegment(request.segmentId)?.name ?? request.segmentId;
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["requests"] });

  const respond = useMutation({
    mutationFn: () => addResponse(request.id, reply.trim(), getDeviceToken()),
    onSuccess: () => {
      setReply("");
      invalidate();
    },
  });
  const mark = useMutation({
    mutationFn: (status: "matched" | "resolved") => patchRequest(request.id, status, getDeviceToken()),
    onSuccess: invalidate,
  });
  const flagReq = useMutation({ mutationFn: () => flagRequest(request.id), onSuccess: invalidate });
  const flagResp = useMutation({ mutationFn: (id: string) => flagResponse(id), onSuccess: invalidate });

  return (
    <article className={`rounded-2xl border border-edge border-l-[3px] bg-paper-raised p-4 ${KIND_ACCENT[request.kind]}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${KIND_PILL[request.kind]}`}>
            {KIND_LABEL[request.kind]}
          </span>
          <span className="text-xs text-ink-2">
            {categoryGlyph(request.category)} {categoryLabel(request.category)}
          </span>
        </div>
        <span className="text-[11px] text-ink-3">{timeAgo(request.createdAt)}</span>
      </div>

      <p className="mt-2 text-[15px] leading-relaxed text-ink">{request.body}</p>
      <p className="mt-1 text-xs text-ink-3">
        {location}
        {request.locationDesc ? ` · ${request.locationDesc}` : ""}
        {request.contactMethod === "phone" && request.contactValue ? ` · 📞 ${request.contactValue}` : ""}
      </p>

      {/* Response thread. */}
      {request.responses.length > 0 && (
        <ul className="mt-3 space-y-2 border-l border-edge pl-3">
          {request.responses.map((r) => (
            <li key={r.id} className="text-sm text-ink-2">
              <span>{r.body}</span>
              <span className="ml-2 text-[11px] text-ink-3">{timeAgo(r.createdAt)}</span>
              <button
                type="button"
                onClick={() => flagResp.mutate(r.id)}
                className="ml-2 text-[11px] text-ink-3 hover:text-closed"
                aria-label="Flag response"
              >
                ⚑
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Add a response (in-app thread). */}
      <div className="mt-3 flex items-center gap-2">
        <input
          type="text"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          maxLength={300}
          placeholder="Offer help, info, or eyes on it…"
          className="flex-1 rounded-lg border border-edge bg-paper px-3 py-1.5 text-sm text-ink placeholder:text-ink-3"
        />
        <button
          type="button"
          disabled={!reply.trim() || respond.isPending}
          onClick={() => respond.mutate()}
          className="rounded-lg bg-community px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
        >
          Reply
        </button>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <button type="button" onClick={() => flagReq.mutate()} className="text-[11px] text-ink-3 hover:text-closed">
          ⚑ Flag
        </button>
        {owned && (
          <span className="flex gap-2">
            <button
              type="button"
              onClick={() => mark.mutate("matched")}
              className="rounded-lg border border-edge px-2.5 py-1 text-[11px] text-ink-2"
            >
              Mark matched
            </button>
            <button
              type="button"
              onClick={() => mark.mutate("resolved")}
              className="rounded-lg border border-edge px-2.5 py-1 text-[11px] text-ink-2"
            >
              Resolved
            </button>
          </span>
        )}
      </div>
    </article>
  );
}
