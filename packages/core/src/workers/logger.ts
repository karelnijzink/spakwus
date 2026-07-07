// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

/** Minimal logger shape so workers accept a Fastify logger or the console. */
export interface Logger {
  info(msg: unknown, ...args: unknown[]): void;
  warn(msg: unknown, ...args: unknown[]): void;
  error(msg: unknown, ...args: unknown[]): void;
}

export const consoleLogger: Logger = {
  info: (msg, ...args) => console.log(msg, ...args),
  warn: (msg, ...args) => console.warn(msg, ...args),
  error: (msg, ...args) => console.error(msg, ...args),
};
