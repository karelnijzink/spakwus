// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { useState } from "react";
import { SEGMENTS, getSegment, type SegmentId } from "@nissegroup/shared";

/**
 * Backend-free incident reporting. Without a Spakwus server there's nowhere to
 * store a report, so instead we capture the incident + the reporter's location
 * and hand it to the device's share sheet (or clipboard) — so the word gets out
 * fast to whatever channel people already use (the Sea to Sky group, a text to
 * someone heading up). When a backend is configured, the full ReportForm (which
 * feeds status) is used instead.
 */
const TYPES = [
  { type: "crash", label: "Crash", glyph: "💥" },
  { type: "hazard", label: "Hazard", glyph: "⚠️" },
  { type: "debris", label: "Debris", glyph: "🪨" },
  { type: "stopped-traffic", label: "Stopped traffic", glyph: "🚗" },
  { type: "weather", label: "Weather", glyph: "🌧️" },
  { type: "wildlife", label: "Wildlife", glyph: "🦌" },
] as const;

export function ShareReport({ defaultSegmentId, onDone }: { defaultSegmentId?: SegmentId; onDone?: () => void }) {
  const [incidentType, setIncidentType] = useState<string | null>(null);
  const [segmentId, setSegmentId] = useState<SegmentId>(defaultSegmentId ?? SEGMENTS[0]!.id);
  const [geo, setGeo] = useState<{ lat: number; lon: number } | null>(null);
  const [geoState, setGeoState] = useState<"idle" | "locating" | "denied">("idle");
  const [note, setNote] = useState("");
  const [done, setDone] = useState<"shared" | "copied" | null>(null);

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

  const buildText = (): string => {
    const label = TYPES.find((t) => t.type === incidentType)?.label ?? "Incident";
    const where = geo
      ? `${geo.lat.toFixed(4)}, ${geo.lon.toFixed(4)} — https://maps.google.com/?q=${geo.lat},${geo.lon}`
      : getSegment(segmentId)?.name ?? "the Sea to Sky corridor";
    const extra = note.trim() ? ` ${note.trim()}.` : "";
    return `🚨 Sea to Sky (Hwy 99) — ${label} near ${where}.${extra} Reported via Spakwus.`;
  };

  const share = async () => {
    if (!incidentType) return;
    const text = buildText();
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: "Sea to Sky incident", text });
        setDone("shared");
      } else {
        await navigator.clipboard.writeText(text);
        setDone("copied");
      }
    } catch {
      /* user dismissed the share sheet — leave the form as-is */
    }
  };

  if (done) {
    return (
      <div className="rounded-2xl border border-open/30 bg-open-bg/60 p-5 text-center">
        <p className="font-display text-lg text-open">
          {done === "shared" ? "Shared — thank you." : "Copied to your clipboard."}
        </p>
        <p className="mt-1 text-sm text-ink-2">
          Post it to your Sea to Sky group or send it to whoever's heading up the highway. Getting
          the word out fast is the whole point.
        </p>
        <button
          type="button"
          onClick={() => {
            setDone(null);
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
        <p id="share-type-label" className="text-sm font-medium text-ink">
          What did you see?
        </p>
        <div role="radiogroup" aria-labelledby="share-type-label" className="mt-2 grid grid-cols-3 gap-2">
          {TYPES.map((t) => (
            <button
              key={t.type}
              type="button"
              role="radio"
              aria-checked={incidentType === t.type}
              onClick={() => setIncidentType(t.type)}
              className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-xs transition ${
                incidentType === t.type
                  ? "border-pine bg-open-bg font-semibold text-ink"
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
            aria-label="Location"
            className="flex-1 rounded-lg border border-edge bg-paper px-3 py-2 text-sm text-ink"
          >
            {geo && <option value="__geo">Using your location</option>}
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
            {geoState === "locating" ? (
              "Locating…"
            ) : (
              <>
                <span aria-hidden>📍</span> Use my location
              </>
            )}
          </button>
        </div>
        {geoState === "denied" && (
          <p className="mt-1 text-xs text-ink-3">Location unavailable — pick a segment above.</p>
        )}
      </div>

      <div>
        <label className="text-sm font-medium text-ink" htmlFor="share-note">
          Details <span className="font-normal text-ink-3">(optional)</span>
        </label>
        <textarea
          id="share-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          rows={2}
          placeholder="e.g. one lane getting by, crews on scene"
          className="mt-1 w-full rounded-lg border border-edge bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-3"
        />
      </div>

      <button
        type="button"
        onClick={share}
        disabled={!incidentType}
        className="w-full rounded-xl bg-pine px-4 py-3 text-sm font-semibold text-paper transition disabled:opacity-40"
      >
        Share the report
      </button>
      <p className="text-[11px] leading-relaxed text-ink-3">
        Shares to your apps (message, the Sea to Sky group…) so the word gets out. Don't report
        while driving. For emergencies call 911.
      </p>
    </div>
  );
}
