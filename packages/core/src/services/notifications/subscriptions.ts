// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type {
  NotificationChannel,
  SegmentId,
  SubscriptionDirection,
  SubscriptionScope,
} from "@nissegroup/shared";
import type { DbContext } from "../../db/client.js";
import { notificationSubscriptions } from "../../db/schema.js";
import type { Config } from "../../config.js";
import type { Senders } from "./channels.js";

function targetKey(channel: NotificationChannel, target: string): string {
  if (channel === "webpush") {
    try {
      return (JSON.parse(target) as { endpoint?: string }).endpoint ?? target;
    } catch {
      return target;
    }
  }
  if (channel === "email") return target.trim().toLowerCase();
  return target.trim();
}

export interface CreateSubscriptionInput {
  channel: NotificationChannel;
  scope: SubscriptionScope;
  segmentId?: SegmentId;
  direction?: SubscriptionDirection;
  target: string;
  quietHours?: boolean;
}

export type CreateSubscriptionResult =
  | {
      ok: true;
      subscription: { id: string; channel: NotificationChannel; verified: boolean; unsubscribeToken: string };
      pendingVerification: boolean;
    }
  | { ok: false; error: "channel_unavailable" };

export interface SubscriptionDeps {
  ctx: DbContext;
  config: Config;
  senders: Senders;
}

export async function createSubscription(
  input: CreateSubscriptionInput,
  deps: SubscriptionDeps,
): Promise<CreateSubscriptionResult> {
  const { ctx, config, senders } = deps;
  if (!senders.available.has(input.channel)) return { ok: false, error: "channel_unavailable" };

  const key = targetKey(input.channel, input.target);
  const scope = input.scope;
  const segmentId = scope === "segment" ? (input.segmentId ?? null) : null;
  const direction = input.direction ?? "both";

  // Reactivate an identical existing subscription rather than duplicate.
  const existing = await ctx.db
    .select()
    .from(notificationSubscriptions)
    .where(
      and(
        eq(notificationSubscriptions.channel, input.channel),
        eq(notificationSubscriptions.targetKey, key),
        eq(notificationSubscriptions.scope, scope),
        eq(notificationSubscriptions.direction, direction),
        eq(notificationSubscriptions.active, true),
      ),
    );
  const match = existing.find((s) => (s.segmentId ?? null) === segmentId);
  if (match) {
    return {
      ok: true,
      subscription: { id: match.id, channel: match.channel, verified: match.verified, unsubscribeToken: match.unsubscribeToken },
      pendingVerification: !match.verified,
    };
  }

  // Email requires double opt-in; other channels are self-proving.
  const verified = input.channel !== "email";
  const verifyToken = input.channel === "email" ? randomUUID() : null;
  const unsubscribeToken = randomUUID();

  const [row] = await ctx.db
    .insert(notificationSubscriptions)
    .values({
      channel: input.channel,
      scope,
      segmentId,
      direction,
      target: input.target,
      targetKey: key,
      verified,
      verifyToken,
      unsubscribeToken,
      quietHours: input.quietHours ?? false,
      active: true,
    })
    .returning();

  if (input.channel === "email" && senders.sendEmail && verifyToken) {
    const link = `${config.PUBLIC_BASE_URL}/api/notifications/verify?token=${verifyToken}`;
    await senders
      .sendEmail(
        input.target,
        "Confirm your Spakwus alerts",
        `Confirm you want Sea to Sky (Highway 99) alerts from Spakwus:\n\n${link}\n\nIf you didn't request this, ignore this email.`,
      )
      .catch(() => {
        /* delivery is best-effort; the token stays valid */
      });
  }

  return {
    ok: true,
    subscription: { id: row!.id, channel: row!.channel, verified: row!.verified, unsubscribeToken: row!.unsubscribeToken },
    pendingVerification: !verified,
  };
}

export async function verifyEmailSubscription(ctx: DbContext, token: string): Promise<boolean> {
  const rows = await ctx.db
    .update(notificationSubscriptions)
    .set({ verified: true, verifyToken: null })
    .where(eq(notificationSubscriptions.verifyToken, token))
    .returning({ id: notificationSubscriptions.id });
  return rows.length > 0;
}

export async function unsubscribe(ctx: DbContext, token: string): Promise<boolean> {
  const rows = await ctx.db
    .update(notificationSubscriptions)
    .set({ active: false })
    .where(eq(notificationSubscriptions.unsubscribeToken, token))
    .returning({ id: notificationSubscriptions.id });
  return rows.length > 0;
}
