// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import type { Config } from "../config.js";
import type { Senders } from "./notifications/channels.js";
import { consoleLogger, type Logger } from "../workers/logger.js";

/**
 * Deliver an operator alert to every configured sink. Distinct from the public
 * notification fan-out — these go to whoever runs the deployment:
 *  - OPERATOR_WEBHOOK_URL — a generic `{ text }` POST (Slack / Discord / a pager).
 *  - OPERATOR_EMAIL — via the email sender (Resend, or the dev log stub).
 *  - OPERATOR_TELEGRAM_CHAT_ID — a direct message via the Telegram bot.
 *
 * Best-effort and independent per sink; a failing sink never blocks the others.
 */
export async function sendOperatorAlert(
  config: Config,
  senders: Senders | undefined,
  subject: string,
  body: string,
  log: Logger = consoleLogger,
): Promise<void> {
  const text = `[Spakwus] ${subject}\n${body}`;
  const tasks: Promise<unknown>[] = [];

  if (config.OPERATOR_WEBHOOK_URL) {
    tasks.push(
      fetch(config.OPERATOR_WEBHOOK_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      }).catch((err) => log.warn("operator alert: webhook failed", err)),
    );
  }

  if (config.OPERATOR_EMAIL && senders?.sendEmail) {
    tasks.push(
      senders
        .sendEmail(config.OPERATOR_EMAIL, `Spakwus alert: ${subject}`, body)
        .catch((err: unknown) => log.warn("operator alert: email failed", err)),
    );
  }

  if (config.OPERATOR_TELEGRAM_CHAT_ID && senders?.byChannel.telegram) {
    tasks.push(
      senders.byChannel.telegram
        .send(config.OPERATOR_TELEGRAM_CHAT_ID, {
          title: `Spakwus alert: ${subject}`,
          body,
          url: `${config.PUBLIC_BASE_URL}/health`,
        })
        .catch((err: unknown) => log.warn("operator alert: telegram failed", err)),
    );
  }

  if (tasks.length === 0) {
    log.warn(`operator alert (no sink configured): ${subject} — ${body}`);
    return;
  }
  await Promise.allSettled(tasks);
}
