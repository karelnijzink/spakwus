// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SEGMENTS, type SegmentId, type StatusLevel } from "@nissegroup/shared";
import { admin, ApiError } from "../api/client.js";
import type { QueueReport } from "../api/types.js";
import { kindLabel, sourceLabel } from "../lib/status.js";
import { timeAgo } from "../lib/time.js";

const TOKEN_KEY = "spakwus:stewardToken";

function loadToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function Admin() {
  const [token, setToken] = useState(loadToken());

  if (!token) {
    return <Login onLogin={(t) => setToken(t)} />;
  }
  return (
    <Dashboard
      token={token}
      onLogout={() => {
        try {
          localStorage.removeItem(TOKEN_KEY);
        } catch {
          /* ignore */
        }
        setToken("");
      }}
    />
  );
}

function Login({ onLogin }: { onLogin: (token: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="mx-auto max-w-sm space-y-4 py-8">
      <div>
        <p className="text-[11px] uppercase tracking-eyebrow text-ink-3">Steward access</p>
        <h1 className="mt-1 font-display text-2xl text-ink">Moderation</h1>
      </div>
      <p className="text-sm text-ink-2">Enter your steward token to review reports and set overrides.</p>
      <input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Steward token"
        className="w-full rounded-lg border border-edge bg-paper px-3 py-2 text-sm text-ink"
      />
      <button
        type="button"
        disabled={!value.trim()}
        onClick={() => {
          const t = value.trim();
          try {
            localStorage.setItem(TOKEN_KEY, t);
          } catch {
            /* ignore */
          }
          onLogin(t);
        }}
        className="w-full rounded-xl bg-pine px-4 py-3 text-sm font-semibold text-paper disabled:opacity-40"
      >
        Sign in
      </button>
    </div>
  );
}

function Dashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const qc = useQueryClient();
  const [state, setState] = useState("pending");
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["admin"] });
    void qc.invalidateQueries({ queryKey: ["snapshot"] });
    void qc.invalidateQueries({ queryKey: ["incidents"] });
  };

  const reportsQ = useQuery({
    queryKey: ["admin", "reports", token, state],
    queryFn: () => admin.reports(token, state),
    retry: false,
  });
  const overridesQ = useQuery({
    queryKey: ["admin", "overrides", token],
    queryFn: () => admin.overrides(token),
    retry: false,
  });
  const auditQ = useQuery({
    queryKey: ["admin", "audit", token],
    queryFn: () => admin.audit(token),
    retry: false,
  });

  const unauthorized =
    reportsQ.error instanceof ApiError && (reportsQ.error.status === 401 || reportsQ.error.status === 503);

  const verify = useMutation({ mutationFn: (id: string) => admin.verify(token, id), onSuccess: invalidate });
  const dismiss = useMutation({
    mutationFn: (id: string) => admin.dismiss(token, id, "dismissed by steward"),
    onSuccess: invalidate,
  });
  const merge = useMutation({
    mutationFn: (v: { ids: string[]; target: string }) => admin.merge(token, v.ids, v.target),
    onSuccess: invalidate,
  });

  if (unauthorized) {
    return (
      <div className="space-y-3 py-8 text-center">
        <p className="text-sm text-closed">That token isn't authorized (or steward auth isn't configured).</p>
        <button type="button" onClick={onLogout} className="text-sm text-ink-2 underline decoration-edge underline-offset-2">
          Use a different token
        </button>
      </div>
    );
  }

  const reports = reportsQ.data?.reports ?? [];
  const overrides = overridesQ.data?.overrides ?? [];
  const audit = auditQ.data?.entries ?? [];
  const incidentIds = [...new Set(reports.map((r) => r.incidentId).filter(Boolean))] as string[];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-eyebrow text-ink-3">Steward</p>
          <h1 className="font-display text-2xl text-ink">Moderation</h1>
        </div>
        <button type="button" onClick={onLogout} className="text-xs text-ink-3 underline decoration-edge underline-offset-2">
          Sign out
        </button>
      </div>

      {/* Queue */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-eyebrow text-ink-3">Report queue</h2>
          <select
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="rounded-lg border border-edge bg-paper px-2 py-1 text-xs text-ink"
          >
            {["pending", "verified", "dismissed", "all"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        {reports.length === 0 ? (
          <p className="rounded-xl border border-edge bg-paper-raised p-4 text-sm text-ink-3">Queue is empty.</p>
        ) : (
          <div className="space-y-3">
            {reports.map((r) => (
              <ReportRow
                key={r.id}
                report={r}
                incidentIds={incidentIds}
                onVerify={() => verify.mutate(r.id)}
                onDismiss={() => dismiss.mutate(r.id)}
                onMerge={(target) => merge.mutate({ ids: [r.id], target })}
                busy={verify.isPending || dismiss.isPending || merge.isPending}
              />
            ))}
          </div>
        )}
      </section>

      <OverridePanel token={token} overrides={overrides} onChange={invalidate} />

      {/* Audit */}
      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-eyebrow text-ink-3">Audit trail</h2>
        <div className="space-y-1.5">
          {audit.map((e) => (
            <p key={e.id} className="text-xs text-ink-3">
              <span className="font-medium text-ink-2">{e.action}</span> · {e.actor} · {timeAgo(e.createdAt)}
              {e.reason ? ` · ${e.reason}` : ""}
            </p>
          ))}
          {audit.length === 0 && <p className="text-xs text-ink-3">No actions yet.</p>}
        </div>
      </section>
    </div>
  );
}

function ReportRow({
  report,
  incidentIds,
  onVerify,
  onDismiss,
  onMerge,
  busy,
}: {
  report: QueueReport;
  incidentIds: string[];
  onVerify: () => void;
  onDismiss: () => void;
  onMerge: (target: string) => void;
  busy: boolean;
}) {
  const [mergeTarget, setMergeTarget] = useState("");
  const others = incidentIds.filter((id) => id !== report.incidentId);
  return (
    <div className="rounded-xl border border-edge bg-paper-raised p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-base text-ink">
            {report.incidentType ? report.incidentType : kindLabel(report.kind)}{" "}
            <span className="font-sans text-sm font-normal text-ink-2">· {report.segmentName}</span>
          </p>
          {report.note && <p className="mt-1 text-sm text-ink-2">{report.note}</p>}
          <p className="mt-1 text-[11px] text-ink-3">
            {sourceLabel(report.source === "web" ? "community" : report.source)} · {report.trustLevel} ·{" "}
            {report.moderationState} · {timeAgo(report.createdAt)}
            {report.contact ? ` · contact: ${report.contact}` : ""}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onVerify}
          className="rounded-lg bg-pine px-3 py-1.5 text-xs font-semibold text-paper disabled:opacity-40"
        >
          Verify
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onDismiss}
          className="rounded-lg border border-closed/40 px-3 py-1.5 text-xs font-semibold text-closed disabled:opacity-40"
        >
          Dismiss
        </button>
        {others.length > 0 && (
          <span className="flex items-center gap-1">
            <select
              value={mergeTarget}
              onChange={(e) => setMergeTarget(e.target.value)}
              className="rounded-lg border border-edge bg-paper px-2 py-1 text-xs text-ink"
            >
              <option value="">Merge into…</option>
              {others.map((id) => (
                <option key={id} value={id}>
                  {id.slice(0, 8)}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy || !mergeTarget}
              onClick={() => onMerge(mergeTarget)}
              className="rounded-lg border border-edge px-2 py-1.5 text-xs text-ink-2 disabled:opacity-40"
            >
              Merge
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

function OverridePanel({
  token,
  overrides,
  onChange,
}: {
  token: string;
  overrides: { id: string; segmentId: SegmentId; status: StatusLevel; reason: string }[];
  onChange: () => void;
}) {
  const [segmentId, setSegmentId] = useState<SegmentId>(SEGMENTS[0]!.id);
  const [status, setStatus] = useState<StatusLevel>("CLOSED");
  const [reason, setReason] = useState("");

  const create = useMutation({
    mutationFn: () => admin.createOverride(token, { segmentId, status, reason: reason.trim() }),
    onSuccess: () => {
      setReason("");
      onChange();
    },
  });
  const clear = useMutation({
    mutationFn: (id: string) => admin.clearOverride(token, id),
    onSuccess: onChange,
  });

  return (
    <section>
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-eyebrow text-ink-3">Manual override</h2>
      <div className="space-y-3 rounded-xl border border-edge bg-paper-raised p-4">
        <div className="flex flex-wrap gap-2">
          <select
            value={segmentId}
            onChange={(e) => setSegmentId(e.target.value as SegmentId)}
            className="flex-1 rounded-lg border border-edge bg-paper px-3 py-2 text-sm text-ink"
          >
            {SEGMENTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusLevel)}
            className="rounded-lg border border-edge bg-paper px-3 py-2 text-sm text-ink"
          >
            {(["OPEN", "PARTIAL", "CLOSED"] as StatusLevel[]).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (required — shown publicly)"
          className="w-full rounded-lg border border-edge bg-paper px-3 py-2 text-sm text-ink"
        />
        <button
          type="button"
          disabled={reason.trim().length < 3 || create.isPending}
          onClick={() => create.mutate()}
          className="w-full rounded-xl bg-pine px-4 py-2.5 text-sm font-semibold text-paper disabled:opacity-40"
        >
          Set override
        </button>
      </div>

      {overrides.length > 0 && (
        <ul className="mt-3 space-y-2">
          {overrides.map((o) => (
            <li key={o.id} className="flex items-center justify-between rounded-xl border border-edge bg-paper-raised px-4 py-2.5">
              <span className="text-sm text-ink-2">
                <span className="font-semibold text-ink">{o.status}</span> · {o.segmentId} — {o.reason}
              </span>
              <button
                type="button"
                onClick={() => clear.mutate(o.id)}
                className="text-xs text-ink-3 underline decoration-edge underline-offset-2"
              >
                Clear
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
