// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { SEGMENTS, type SegmentId } from "@nissegroup/shared";
import { fetchNotificationConfig, subscribe, unsubscribe, ApiError } from "../api/client.js";
import type { NotifChannel, SubDirection, SubScope, SubscribeRequest } from "../api/types.js";
import { subscribeWebPush, webPushSupported } from "../lib/webpush.js";
import { loadLocalSubs, removeLocalSub, saveLocalSub, type LocalSub } from "../lib/localSubs.js";

function segLabel(id: string | null | undefined): string {
  return SEGMENTS.find((s) => s.id === id)?.name ?? "the whole corridor";
}

export function Alerts() {
  const [params] = useSearchParams();
  const justVerified = params.get("verified") === "1";
  const cfg = useQuery({ queryKey: ["notif-config"], queryFn: fetchNotificationConfig, retry: 1 });

  const [scope, setScope] = useState<SubScope>("corridor");
  const [segmentId, setSegmentId] = useState<SegmentId>(SEGMENTS[0]!.id);
  const [direction, setDirection] = useState<SubDirection>("both");
  const [quietHours, setQuietHours] = useState(false);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  // Lazy initialiser so localStorage is read once, not on every render.
  const [subs, setSubs] = useState<LocalSub[]>(() => loadLocalSubs());
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);

  // Bring the confirmation/error into view — the subscribe buttons sit far down
  // the page, so a message at the top would otherwise be missed on a phone.
  useEffect(() => {
    if (notice || error) feedbackRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [notice, error]);

  const channels = cfg.data?.channels ?? [];
  const has = (c: NotifChannel) => channels.includes(c);

  const baseBody = (channel: NotifChannel, target: string): SubscribeRequest => ({
    channel,
    scope,
    ...(scope === "segment" ? { segmentId } : {}),
    direction,
    target,
    quietHours,
  });

  const doSubscribe = async (channel: NotifChannel, target: string, labelSuffix: string) => {
    setError(null);
    setNotice(null);
    try {
      const res = await subscribe(baseBody(channel, target));
      const sub: LocalSub = {
        id: res.subscription.id,
        channel,
        scope,
        segmentId: scope === "segment" ? segmentId : null,
        direction,
        unsubscribeToken: res.subscription.unsubscribeToken,
        verified: res.subscription.verified,
        label: `${labelSuffix} · ${scope === "segment" ? segLabel(segmentId) : "whole corridor"}`,
      };
      saveLocalSub(sub);
      setSubs(loadLocalSubs());
      setNotice(
        res.pendingVerification
          ? "Check your email and click the link to confirm your alerts."
          : `Subscribed — you'll be alerted for ${scope === "segment" ? segLabel(segmentId) : "the whole corridor"}.`,
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Couldn't subscribe.");
    }
  };

  const removeSub = async (sub: LocalSub) => {
    await unsubscribe(sub.unsubscribeToken);
    removeLocalSub(sub.id);
    setSubs(loadLocalSubs());
  };

  return (
    <div className="mx-auto max-w-content space-y-6">
      <div>
        <p className="text-[11px] uppercase tracking-eyebrow text-ink-3">Stay ahead of it</p>
        <h1 className="mt-1 font-display text-3xl text-ink">Get alerts</h1>
        <p className="mt-1 text-sm text-ink-2">
          We warn you the moment Highway 99 flips to restricted or closed — and when it reopens — so you can wait in
          town instead of getting stranded. Alerts fire only off confirmed status changes, never off a single report.
        </p>
      </div>

      {justVerified && (
        <p className="rounded-xl border border-open/30 bg-open-bg/60 px-4 py-3 text-sm text-open">
          Email confirmed — you're all set.
        </p>
      )}
      <div ref={feedbackRef} aria-live="polite">
        {notice && (
          <p role="status" className="rounded-xl border border-open/30 bg-open-bg/60 px-4 py-3 text-sm text-open">
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-xl border border-closed/30 bg-closed-bg/60 px-4 py-3 text-sm text-closed">
            {error}
          </p>
        )}
      </div>

      {/* Scope / direction / quiet hours. */}
      <div className="space-y-4 rounded-2xl border border-edge bg-paper-raised p-5">
        <div>
          <p id="alert-scope-label" className="text-sm font-medium text-ink">
            What do you want alerts for?
          </p>
          <div role="radiogroup" aria-labelledby="alert-scope-label" className="mt-2 flex gap-2">
            <button
              type="button"
              role="radio"
              aria-checked={scope === "corridor"}
              onClick={() => setScope("corridor")}
              className={`rounded-lg border px-3 py-1.5 text-sm ${scope === "corridor" ? "border-pine bg-open-bg font-semibold text-ink" : "border-edge text-ink-2"}`}
            >
              Whole corridor
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={scope === "segment"}
              onClick={() => setScope("segment")}
              className={`rounded-lg border px-3 py-1.5 text-sm ${scope === "segment" ? "border-pine bg-open-bg font-semibold text-ink" : "border-edge text-ink-2"}`}
            >
              A segment
            </button>
          </div>
          {scope === "segment" && (
            <select
              value={segmentId}
              onChange={(e) => setSegmentId(e.target.value as SegmentId)}
              className="mt-2 w-full rounded-lg border border-edge bg-paper px-3 py-2 text-sm text-ink"
            >
              {SEGMENTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <p id="alert-direction-label" className="text-sm font-medium text-ink">
            Direction
          </p>
          <div role="radiogroup" aria-labelledby="alert-direction-label" className="mt-2 flex gap-2">
            {(["both", "north", "south"] as SubDirection[]).map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={direction === d}
                onClick={() => setDirection(d)}
                className={`rounded-lg border px-3 py-1.5 text-sm capitalize ${direction === d ? "border-pine bg-open-bg font-semibold text-ink" : "border-edge text-ink-2"}`}
              >
                {d === "both" ? "Both ways" : `${d}bound`}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" checked={quietHours} onChange={(e) => setQuietHours(e.target.checked)} />
          Quiet hours (10pm–7am) — <span className="text-ink-3">closures always alert; restrictions stay silent overnight.</span>
        </label>
      </div>

      {/* Channels. */}
      <div className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-eyebrow text-ink-3">Choose a channel</p>

        {/* Web push */}
        <div className="rounded-2xl border border-edge bg-paper-raised p-4">
          <p className="text-sm font-medium text-ink">Push notifications</p>
          <p className="mt-0.5 text-xs text-ink-3">Instant, no account. Best if you install Spakwus to your home screen.</p>
          {has("webpush") && webPushSupported() ? (
            <button
              type="button"
              onClick={async () => {
                try {
                  const target = await subscribeWebPush(cfg.data!.vapidPublicKey!);
                  await doSubscribe("webpush", target, "Push");
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Push failed.");
                }
              }}
              className="mt-2 rounded-xl bg-pine px-4 py-2 text-sm font-semibold text-paper"
            >
              Enable push
            </button>
          ) : (
            <p className="mt-2 text-xs text-ink-3">
              Push isn't available here{cfg.data && !has("webpush") ? " (server not configured)" : " — install the app first"}.
            </p>
          )}
        </div>

        {/* Email */}
        {has("email") && (
          <div className="rounded-2xl border border-edge bg-paper-raised p-4">
            <p className="text-sm font-medium text-ink">Email</p>
            <p className="mt-0.5 text-xs text-ink-3">Double opt-in — we send one confirmation email first.</p>
            <div className="mt-2 flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-label="Email address for alerts"
                placeholder="you@example.com"
                className="flex-1 rounded-lg border border-edge bg-paper px-3 py-2 text-sm text-ink"
              />
              <button
                type="button"
                disabled={!email.includes("@")}
                onClick={() => doSubscribe("email", email.trim(), "Email")}
                className="rounded-xl bg-pine px-4 py-2 text-sm font-semibold text-paper disabled:opacity-40"
              >
                Subscribe
              </button>
            </div>
          </div>
        )}

        {/* Telegram */}
        {has("telegram") && (
          <div className="rounded-2xl border border-edge bg-paper-raised p-4">
            <p className="text-sm font-medium text-ink">Telegram</p>
            <p className="mt-0.5 text-xs text-ink-3">Every alert is posted to a public channel; DM the bot for personal alerts.</p>
            {cfg.data?.telegramBot ? (
              <a
                href={`https://t.me/${cfg.data.telegramBot}?start=alerts`}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block rounded-xl bg-pine px-4 py-2 text-sm font-semibold text-paper"
              >
                Open Telegram bot
              </a>
            ) : (
              <p className="mt-2 text-xs text-ink-3">Bot not configured on this server.</p>
            )}
          </div>
        )}

        {/* SMS (paid add-on, off by default) */}
        {has("sms") && (
          <div className="rounded-2xl border border-edge bg-paper-raised p-4">
            <p className="text-sm font-medium text-ink">SMS <span className="text-xs font-normal text-ink-3">(paid add-on)</span></p>
            <div className="mt-2 flex gap-2">
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                aria-label="Mobile number for SMS alerts"
                placeholder="+1 604 555 0100"
                className="flex-1 rounded-lg border border-edge bg-paper px-3 py-2 text-sm text-ink"
              />
              <button
                type="button"
                disabled={phone.trim().length < 7}
                onClick={() => doSubscribe("sms", phone.trim(), "SMS")}
                className="rounded-xl bg-pine px-4 py-2 text-sm font-semibold text-paper disabled:opacity-40"
              >
                Subscribe
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Current subscriptions. */}
      {subs.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-eyebrow text-ink-3">Your subscriptions</p>
          <ul className="space-y-2">
            {subs.map((s) => (
              <li key={s.id} className="flex items-center justify-between rounded-xl border border-edge bg-paper-raised px-4 py-2.5">
                <span className="text-sm text-ink-2">
                  <span className="font-medium capitalize text-ink">{s.channel === "webpush" ? "Push" : s.channel}</span> · {s.label}
                  {!s.verified && <span className="ml-2 text-xs text-partial">unconfirmed</span>}
                </span>
                <button type="button" onClick={() => removeSub(s)} className="text-xs text-ink-3 underline decoration-edge underline-offset-2">
                  Unsubscribe
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="border-t border-edge pt-4 text-xs text-ink-3">
        Alerts come from the deterministic status engine — a full closure always sends immediately. Community requests
        never trigger alerts.
      </p>
    </div>
  );
}
