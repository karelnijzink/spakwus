// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SEGMENTS, type SegmentId } from "@nissegroup/shared";
import { ApiError, postReport } from "../api/client.js";
import type { IncidentType, SubmitReportRequest } from "../api/types.js";
import { getDeviceToken } from "../lib/deviceToken.js";

const TYPES: { type: IncidentType; label: string; glyph: string }[] = [
  { type: "crash", label: "Crash", glyph: "💥" },
  { type: "hazard", label: "Hazard", glyph: "⚠️" },
  { type: "debris", label: "Debris", glyph: "🪨" },
  { type: "stopped-traffic", label: "Stopped traffic", glyph: "🚗" },
  { type: "weather", label: "Weather", glyph: "🌧️" },
  { type: "wildlife", label: "Wildlife", glyph: "🦌" },
];

export interface ReportFormProps {
  defaultSegmentId?: SegmentId;
  onDone?: () => void;
}

export function ReportForm({ defaultSegmentId, onDone }: ReportFormProps) {
  const queryClient = useQueryClient();
  const [incidentType, setIncidentType] = useState<IncidentType | null>(null);
  const [segmentId, setSegmentId] = useState<SegmentId>(defaultSegmentId ?? SEGMENTS[0]!.id);
  const [note, setNote] = useState("");
  const [contact, setContact] = useState("");
  const [geo, setGeo] = useState<{ lat: number; lon: number } | null>(null);
  const [geoState, setGeoState] = useState<"idle" | "locating" | "denied">("idle");

  const mutation = useMutation({
    mutationFn: (body: SubmitReportRequest) => postReport(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["snapshot"] });
      void queryClient.invalidateQueries({ queryKey: ["incidents"] });
    },
  });

  const useLocation = () => {
    if (!navigator.geolocation) {
      setGeoState("denied");
      return;
    }
    setGeoState("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setGeoState("idle");
      },
      () => setGeoState("denied"),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const submit = () => {
    if (!incidentType) return;
    const body: SubmitReportRequest = {
      incidentType,
      note: note.trim() || undefined,
      contact: contact.trim() || undefined,
      deviceToken: getDeviceToken(),
      ...(geo ? { lat: geo.lat, lon: geo.lon } : { segmentId }),
    };
    mutation.mutate(body);
  };

  if (mutation.isSuccess) {
    return (
      <div className="rounded-2xl border border-open/30 bg-open-bg/60 p-5 text-center">
        <p className="font-display text-lg text-open">Thanks — reported.</p>
        <p className="mt-1 text-sm text-ink-2">
          It'll appear as “reported, unconfirmed” and only affects the status once a
          steward or a second report confirms it.
        </p>
        <button
          type="button"
          onClick={() => {
            mutation.reset();
            setIncidentType(null);
            setNote("");
            onDone?.();
          }}
          className="mt-3 text-sm text-ink-2 underline decoration-edge underline-offset-2"
        >
          Report something else
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-edge bg-paper-raised p-5">
      <div>
        <p className="text-sm font-medium text-ink">What did you see?</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {TYPES.map((t) => (
            <button
              key={t.type}
              type="button"
              onClick={() => setIncidentType(t.type)}
              className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-xs transition ${
                incidentType === t.type
                  ? "border-pine bg-open-bg text-ink"
                  : "border-edge bg-paper text-ink-2 hover:border-ink-3/40"
              }`}
            >
              <span className="text-lg" aria-hidden>
                {t.glyph}
              </span>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-sm font-medium text-ink">Where?</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            value={geo ? "__geo" : segmentId}
            onChange={(e) => {
              if (e.target.value === "__geo") return;
              setGeo(null);
              setSegmentId(e.target.value as SegmentId);
            }}
            className="flex-1 rounded-lg border border-edge bg-paper px-3 py-2 text-sm text-ink"
          >
            {geo && <option value="__geo">📍 Using your location</option>}
            {SEGMENTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={useLocation}
            className="rounded-lg border border-edge bg-paper px-3 py-2 text-sm text-ink-2 hover:border-ink-3/40"
          >
            {geoState === "locating" ? "Locating…" : "📍 Use my location"}
          </button>
        </div>
        {geoState === "denied" && (
          <p className="mt-1 text-xs text-ink-3">Location unavailable — pick a segment above.</p>
        )}
      </div>

      <div>
        <label className="text-sm font-medium text-ink" htmlFor="report-note">
          Anything else? <span className="font-normal text-ink-3">(optional)</span>
        </label>
        <textarea
          id="report-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          rows={2}
          placeholder="e.g. one lane getting by, flaggers on scene"
          className="mt-1 w-full rounded-lg border border-edge bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-3"
        />
      </div>

      <input
        type="text"
        value={contact}
        onChange={(e) => setContact(e.target.value)}
        maxLength={200}
        placeholder="Contact (optional, never shown)"
        className="w-full rounded-lg border border-edge bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-3"
      />

      {mutation.isError && (
        <p className="text-sm text-closed">
          {mutation.error instanceof ApiError && mutation.error.status === 429
            ? mutation.error.message
            : "Couldn't submit — check your connection and try again."}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={!incidentType || mutation.isPending}
        className="w-full rounded-xl bg-pine px-4 py-3 text-sm font-semibold text-paper transition disabled:opacity-40"
      >
        {mutation.isPending ? "Sending…" : "Submit report"}
      </button>
      <p className="text-[11px] leading-relaxed text-ink-3">
        Reports are shown as unconfirmed until corroborated. Don't report while driving.
      </p>
    </div>
  );
}
