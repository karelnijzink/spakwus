// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import webpush from "web-push";
import type { NotificationChannel } from "@nissegroup/shared";
import type { Config } from "../../config.js";
import { consoleLogger, type Logger } from "../../workers/logger.js";
import type { AlertMessage } from "./message.js";

export interface ChannelSender {
  send(target: string, msg: AlertMessage): Promise<void>;
}

export interface Senders {
  /** One sender per available channel. */
  byChannel: Partial<Record<NotificationChannel, ChannelSender>>;
  /** Channels the deployment can actually deliver on. */
  available: Set<NotificationChannel>;
  /** Post one message to the public Telegram channel (channel-wide broadcast). */
  telegramBroadcast?: (msg: AlertMessage) => Promise<void>;
  /** Low-level email (used for double-opt-in confirmations too). */
  sendEmail?: (to: string, subject: string, text: string) => Promise<void>;
}

async function resendEmail(config: Config, to: string, subject: string, text: string): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${config.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: config.EMAIL_FROM, to, subject, text }),
  });
  if (!res.ok) throw new Error(`Resend failed: ${res.status}`);
}

async function telegramSend(token: string, chatId: string, text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  if (!res.ok) throw new Error(`Telegram failed: ${res.status}`);
}

async function twilioSend(config: Config, to: string, body: string): Promise<void> {
  const auth = Buffer.from(`${config.TWILIO_ACCOUNT_SID}:${config.TWILIO_AUTH_TOKEN}`).toString("base64");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: "POST",
    headers: { authorization: `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: config.TWILIO_FROM ?? "", Body: body }),
  });
  if (!res.ok) throw new Error(`Twilio failed: ${res.status}`);
}

/**
 * Build the set of senders the deployment can use. Web push + email are core;
 * Telegram is an included option; SMS is off by default behind ENABLE_SMS.
 */
export function createSenders(config: Config, log: Logger = consoleLogger): Senders {
  const byChannel: Partial<Record<NotificationChannel, ChannelSender>> = {};
  const available = new Set<NotificationChannel>();

  // Web push (VAPID) — core.
  if (config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(config.VAPID_SUBJECT, config.VAPID_PUBLIC_KEY, config.VAPID_PRIVATE_KEY);
    byChannel.webpush = {
      async send(target, msg) {
        const sub = JSON.parse(target) as webpush.PushSubscription;
        await webpush.sendNotification(sub, JSON.stringify({ title: msg.title, body: msg.body, url: msg.url }));
      },
    };
    available.add("webpush");
  }

  // Email — core. Real via Resend, else log (so double opt-in still works in dev).
  const sendEmail = async (to: string, subject: string, text: string) => {
    if (config.RESEND_API_KEY) await resendEmail(config, to, subject, text);
    else log.info(`[email:stub] to=${to} subject=${subject}\n${text}`);
  };
  byChannel.email = { send: (to, msg) => sendEmail(to, msg.title, msg.body) };
  available.add("email");

  // Telegram — included option (channel post + DMs).
  let telegramBroadcast: Senders["telegramBroadcast"];
  if (config.TELEGRAM_BOT_TOKEN) {
    const token = config.TELEGRAM_BOT_TOKEN;
    byChannel.telegram = { send: (chatId, msg) => telegramSend(token, chatId, `${msg.title}\n\n${msg.body}`) };
    available.add("telegram");
    if (config.TELEGRAM_CHANNEL_ID) {
      const channelId = config.TELEGRAM_CHANNEL_ID;
      telegramBroadcast = (msg) => telegramSend(token, channelId, `${msg.title}\n\n${msg.body}`);
    }
  }

  // SMS — off by default, behind the flag.
  if (config.ENABLE_SMS && config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN) {
    byChannel.sms = { send: (to, msg) => twilioSend(config, to, msg.body) };
    available.add("sms");
  }

  return { byChannel, available, telegramBroadcast, sendEmail };
}
