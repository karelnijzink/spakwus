// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

//
// Fan-out fires ONLY off status_changes rows written by the deterministic
// engine. It never reads raw reports or community requests. Each subscriber is
// notified at most once per status_changes row (the de-dup guarantee).
//

import { eq } from "drizzle-orm";
import type { NotificationChannel, SegmentId, StatusLevel } from "@nissegroup/shared";
import type { DbContext } from "../../db/client.js";
import { notificationDeliveries, statusChanges } from "../../db/schema.js";
import type { Config } from "../../config.js";
import { consoleLogger, type Logger } from "../../workers/logger.js";
import type { Senders } from "./channels.js";
import { buildAlertMessage, shouldNotify } from "./message.js";

export interface FanOutDeps {
  ctx: DbContext;
  senders: Senders;
  config: Config;
  now?: Date;
  log?: Logger;
}

interface StatusChangeRow {
  id: string;
  segment_id: SegmentId;
  from_state: StatusLevel | null;
  to_state: StatusLevel;
  reason: string | null;
  created_at: string | Date;
}

function sourceLabel(source: string | undefined): string {
  switch (source) {
    case "official":
      return "official";
    case "override":
      return "steward";
    case "steward":
    case "community":
      return "corroborated";
    default:
      return "community";
  }
}

function isQuietHour(now: Date, config: Config): boolean {
  let hour: number;
  try {
    hour = Number(
      new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver", hour: "numeric", hour12: false }).format(now),
    );
  } catch {
    hour = now.getHours();
  }
  const { QUIET_HOURS_START: s, QUIET_HOURS_END: e } = config;
  return s <= e ? hour >= s && hour < e : hour >= s || hour < e;
}

/** Process all unnotified status_changes rows, delivering to matching subscribers. */
export async function fanOutPending(deps: FanOutDeps): Promise<{ processed: number; sent: number }> {
  const { ctx, senders, config } = deps;
  const now = deps.now ?? new Date();
  const log = deps.log ?? consoleLogger;

  const rows = await ctx.sql<StatusChangeRow[]>`
    SELECT id, segment_id, from_state, to_state, reason, created_at
    FROM status_changes WHERE notified_at IS NULL ORDER BY created_at ASC LIMIT 500`;

  let sent = 0;
  for (const row of rows) {
    if (!shouldNotify(row.from_state, row.to_state)) {
      await ctx.db.update(statusChanges).set({ notifiedAt: now }).where(eq(statusChanges.id, row.id));
      continue;
    }

    // Provenance + location for the copy (read-only; never influences status).
    const segStatus = await ctx.sql<{ source: string }[]>`
      SELECT source FROM segment_status WHERE segment_id = ${row.segment_id}`;
    const incident = await ctx.sql<{ summary: string | null }[]>`
      SELECT summary FROM incidents WHERE segment_id = ${row.segment_id} AND active = true
      ORDER BY (CASE status WHEN 'CLOSED' THEN 2 WHEN 'PARTIAL' THEN 1 ELSE 0 END) DESC, started_at DESC LIMIT 1`;

    const msg = buildAlertMessage({
      segmentId: row.segment_id,
      toState: row.to_state,
      fromState: row.from_state,
      sourceLabel: sourceLabel(segStatus[0]?.source),
      summary: incident[0]?.summary ?? null,
      reason: row.reason,
      at: new Date(row.created_at),
      baseUrl: config.PUBLIC_BASE_URL,
    });

    // Channel-wide Telegram broadcast, once per flip.
    if (senders.telegramBroadcast) {
      await senders.telegramBroadcast(msg).catch((err) => log.warn("telegram broadcast failed", err));
    }

    const isClosure = row.to_state === "CLOSED";
    const quietNow = isQuietHour(now, config);

    // Matching subscriptions: corridor-wide, or this exact segment. Verified only.
    const subs = await ctx.sql<
      { id: string; channel: string; target: string; quiet_hours: boolean }[]
    >`
      SELECT id, channel, target, quiet_hours FROM notification_subscriptions
      WHERE active = true AND verified = true
        AND (scope = 'corridor' OR (scope = 'segment' AND segment_id = ${row.segment_id}))`;

    for (const sub of subs) {
      const sender = senders.byChannel[sub.channel as NotificationChannel];
      if (!sender) continue; // channel not deliverable right now

      // Quiet hours suppress non-closure alerts for opted-in subscribers.
      if (!isClosure && sub.quiet_hours && quietNow) continue;

      // De-dup: one delivery per (subscription, status_change). Insert wins the race.
      const claimed = await ctx.sql<{ id: string }[]>`
        INSERT INTO notification_deliveries (subscription_id, status_change_id, channel)
        VALUES (${sub.id}::uuid, ${row.id}::uuid, ${sub.channel})
        ON CONFLICT (subscription_id, status_change_id) DO NOTHING
        RETURNING id`;
      if (claimed.length === 0) continue; // already delivered

      try {
        await sender.send(sub.target, msg);
        await ctx.db.update(notificationDeliveries).set({ sent: true }).where(eq(notificationDeliveries.id, claimed[0]!.id));
        sent += 1;
      } catch (err) {
        log.warn(`notify: send failed (sub ${sub.id}, channel ${sub.channel})`, err);
      }
    }

    await ctx.db.update(statusChanges).set({ notifiedAt: now }).where(eq(statusChanges.id, row.id));
  }

  return { processed: rows.length, sent };
}

/**
 * OPTIONAL, separate stream: notify a request's owner when someone responds.
 * Never mixed with the status alert fan-out.
 */
export async function notifyRequestResponse(
  senders: Senders,
  notifyChannel: string | null,
  notifyTarget: string | null,
  requestBody: string,
  baseUrl: string,
): Promise<void> {
  if (!notifyChannel || !notifyTarget) return;
  const sender = senders.byChannel[notifyChannel as NotificationChannel];
  if (!sender) return;
  await sender
    .send(notifyTarget, {
      title: "New reply on your Spakwus request",
      body: `Someone replied to "${requestBody.slice(0, 60)}". Open the community board: ${baseUrl}/community`,
      url: `${baseUrl}/community`,
    })
    .catch(() => {
      /* best-effort */
    });
}
