// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { ReportKind } from "@nissegroup/shared";

/**
 * Structured fields extracted from a free-text report.
 *
 * IMPORTANT: this is an enrichment hook only. It runs BEFORE `deriveStatus` to
 * turn raw text into a `kind` + one-line `summary` stored on the report row.
 * `deriveStatus` itself is deterministic and NEVER calls the LLM — status is
 * always derived from already-structured report/event data.
 */
export type Severity = "minor" | "moderate" | "major";

export interface LlmExtraction {
  kind: ReportKind;
  summary: string;
  severity: Severity;
  /** 0..1 model confidence in the extraction (not the road-status confidence). */
  confidence: number;
}

export interface LlmContext {
  /** The canned incident type the reporter selected, if any. */
  incidentType?: string;
  /** The segment the report is on, for context. */
  segmentName?: string;
}

export interface LlmExtractor {
  extract(rawText: string, context?: LlmContext): Promise<LlmExtraction>;
}

const REPORT_KINDS = ["closure", "single-lane", "alternating", "delay", "clear"] as const;

function severityToConfidence(sev: Severity): number {
  return sev === "major" ? 0.8 : sev === "moderate" ? 0.6 : 0.45;
}

// ---------------------------------------------------------------------------
// Deterministic keyword stub — used when no ANTHROPIC_API_KEY is configured,
// and as the fallback when a real LLM call fails.
// ---------------------------------------------------------------------------
export const stubLlmExtractor: LlmExtractor = {
  async extract(rawText: string): Promise<LlmExtraction> {
    const text = rawText.toLowerCase();

    let kind: ReportKind = "delay";
    let severity: Severity = "minor";

    if (/\b(re-?open|reopened|cleared|now open|all clear)\b/.test(text)) {
      kind = "clear";
    } else if (/\b(fully closed|road closed|closed in both|highway closed|full closure)\b/.test(text)) {
      kind = "closure";
      severity = "major";
    } else if (/\balternat/.test(text)) {
      kind = "alternating";
      severity = "moderate";
    } else if (
      /\b(single lane|one lane|lane closed|lane blocked|some lanes)\b/.test(text) ||
      /\bblock(?:ing|ed|s)?\s+(?:a\s+|the\s+|one\s+)?lane\b/.test(text)
    ) {
      kind = "single-lane";
      severity = "moderate";
    } else if (/\b(delay|backed up|congestion|slow|stop and go)\b/.test(text)) {
      kind = "delay";
    }

    const firstSentence = rawText.split(/(?<=[.!?])\s+/)[0]?.trim() ?? rawText.trim();
    const summary = firstSentence.length > 140 ? `${firstSentence.slice(0, 137)}...` : firstSentence;

    return { kind, summary: summary || "Reported condition.", severity, confidence: severityToConfidence(severity) };
  },
};

// ---------------------------------------------------------------------------
// Real LLM extractor — Anthropic Messages API with a forced tool call for
// reliable structured output.
// ---------------------------------------------------------------------------
const ExtractionResult = z.object({
  kind: z.enum(REPORT_KINDS),
  severity: z.enum(["minor", "moderate", "major"]),
  summary: z.string().min(1),
});

const RECORD_TOOL: Anthropic.Tool = {
  name: "record_incident",
  description:
    "Record the structured classification of a road-incident report on BC Highway 99.",
  input_schema: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: [...REPORT_KINDS],
        description:
          "Effect on traffic: 'closure' (fully blocked), 'single-lane' (some lanes blocked), 'alternating' (flaggers/alternating one-way), 'delay' (slow but moving), 'clear' (now reopened / all clear).",
      },
      severity: { type: "string", enum: ["minor", "moderate", "major"] },
      summary: {
        type: "string",
        description: "One neutral factual sentence describing the condition, at most 140 characters.",
      },
    },
    required: ["kind", "severity", "summary"],
    additionalProperties: false,
  },
};

const SYSTEM_PROMPT = [
  "You classify short public reports about road conditions on BC Highway 99 (the Sea to Sky corridor).",
  "Given a canned incident type and a free-text note, call record_incident with:",
  "- kind: how traffic is affected (see the enum descriptions),",
  "- severity: minor / moderate / major,",
  "- summary: one neutral, factual sentence (no speculation, no advice).",
  "Only use kind 'closure' when the note clearly states the road is fully blocked in a direction.",
  "Only use kind 'clear' when the note says the road has reopened.",
].join("\n");

export function createLlmExtractor(opts: { apiKey?: string; model?: string }): LlmExtractor {
  if (!opts.apiKey) return stubLlmExtractor;
  const client = new Anthropic({ apiKey: opts.apiKey });
  const model = opts.model ?? "claude-opus-4-8";

  return {
    async extract(rawText: string, context?: LlmContext): Promise<LlmExtraction> {
      try {
        const userText = [
          context?.incidentType ? `Incident type: ${context.incidentType}` : null,
          context?.segmentName ? `Segment: ${context.segmentName}` : null,
          `Report: ${rawText}`,
        ]
          .filter(Boolean)
          .join("\n");

        const res = await client.messages.create({
          model,
          max_tokens: 512,
          system: SYSTEM_PROMPT,
          tools: [RECORD_TOOL],
          tool_choice: { type: "tool", name: "record_incident" },
          messages: [{ role: "user", content: userText }],
        });

        const block = res.content.find((b) => b.type === "tool_use");
        if (!block || block.type !== "tool_use") {
          return stubLlmExtractor.extract(rawText, context);
        }
        const parsed = ExtractionResult.safeParse(block.input);
        if (!parsed.success) {
          return stubLlmExtractor.extract(rawText, context);
        }
        const summary = parsed.data.summary.slice(0, 180);
        return {
          kind: parsed.data.kind,
          summary,
          severity: parsed.data.severity,
          confidence: severityToConfidence(parsed.data.severity),
        };
      } catch {
        // Network / auth / rate-limit failures fall back to the deterministic stub.
        return stubLlmExtractor.extract(rawText, context);
      }
    },
  };
}
