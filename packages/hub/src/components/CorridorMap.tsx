// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Incident, SnapshotWebcam } from "../api/types.js";
import { CORRIDOR_LINE, corridorBounds, segmentMidpoint } from "../lib/corridorGeo.js";
import { kindLabel } from "../lib/status.js";
import { clockTime } from "../lib/time.js";

/** Free, key-less raster style using OpenStreetMap tiles. */
const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

const STATUS_COLOR: Record<Incident["status"], string> = {
  OPEN: "#2f5d46",
  PARTIAL: "#97671b",
  CLOSED: "#a0392a",
};

const PINE = "#2e4a38";
const PAPER = "#f3efe5";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** A round incident marker (status-coloured), clickable through to detail. */
function incidentMarkerEl(color: string, label: string): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  el.setAttribute("aria-label", label);
  el.style.cssText = `width:20px;height:20px;border-radius:9999px;border:2.5px solid ${PAPER};
    box-shadow:0 1px 4px rgba(35,34,30,.45);cursor:pointer;padding:0;background:${color};`;
  return el;
}

/** A camera marker: a pine pin with a small camera glyph. */
function camMarkerEl(label: string): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  el.setAttribute("aria-label", label);
  el.style.cssText = `display:flex;align-items:center;justify-content:center;width:24px;height:24px;
    border-radius:8px;border:2px solid ${PAPER};box-shadow:0 1px 4px rgba(35,34,30,.4);
    cursor:pointer;padding:0;background:${PINE};`;
  el.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${PAPER}" stroke-width="2">
    <path d="M4 8h3l1.5-2h7L17 8h3v11H4z" stroke-linejoin="round"/><circle cx="12" cy="13" r="3"/></svg>`;
  return el;
}

function popup(html: string): maplibregl.Popup {
  return new maplibregl.Popup({ offset: 16, closeButton: false, className: "spk-popup" }).setHTML(
    `<div style="font-family:'Inter Variable',system-ui,sans-serif;color:#23221e;">${html}</div>`,
  );
}

export function CorridorMap({
  incidents,
  cams,
}: {
  incidents: Incident[];
  cams: SnapshotWebcam[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OSM_STYLE,
      bounds: corridorBounds(),
      fitBoundsOptions: { padding: 36 },
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);

    map.on("load", () => {
      map.resize();
      map.fitBounds(corridorBounds(), { padding: 36, animate: false });
      map.addSource("corridor", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: CORRIDOR_LINE },
        },
      });
      // A soft casing under a solid pine line, so the route reads clearly.
      map.addLayer({
        id: "corridor-casing",
        type: "line",
        source: "corridor",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": PAPER, "line-width": 7, "line-opacity": 0.9 },
      });
      map.addLayer({
        id: "corridor-line",
        type: "line",
        source: "corridor",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": PINE, "line-width": 3.5 },
      });
    });

    mapRef.current = map;
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    for (const m of markersRef.current) m.remove();
    markersRef.current = [];

    for (const incident of incidents) {
      if (!incident.geometry) continue;
      const [lon, lat] = incident.geometry.coordinates;
      const el = incidentMarkerEl(
        STATUS_COLOR[incident.status],
        `${kindLabel(incident.kind)} — ${incident.status.toLowerCase()}. Open details.`,
      );
      el.addEventListener("click", () => navigate(`/incident/${incident.id}`));
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([lon, lat])
        .setPopup(
          popup(
            `<strong style="font-weight:600">${escapeHtml(kindLabel(incident.kind))}</strong>` +
              (incident.summary ? `<div style="margin-top:2px;font-size:12px;color:#56534a">${escapeHtml(incident.summary)}</div>` : "") +
              `<div style="margin-top:4px;font-size:11px;color:#2e4a38">Tap marker for details →</div>`,
          ),
        )
        .addTo(map);
      markersRef.current.push(marker);
    }

    for (const cam of cams) {
      const marker = new maplibregl.Marker({ element: camMarkerEl(`Webcam: ${cam.label}`) })
        .setLngLat(segmentMidpoint(cam.segmentId))
        .setPopup(
          popup(
            `<strong style="font-weight:600">${escapeHtml(cam.label)}</strong>` +
              `<div style="margin-top:2px;font-size:11px;color:#696558">${cam.capturedAt ? "Captured " + escapeHtml(clockTime(cam.capturedAt)) : "Awaiting capture"} · DriveBC</div>`,
          ),
        )
        .addTo(map);
      markersRef.current.push(marker);
    }
  }, [incidents, cams, navigate]);

  return <div ref={containerRef} className="h-full w-full" />;
}
