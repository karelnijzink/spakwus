// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

const KEY = "spakwus:deviceToken";

/** A stable, anonymous per-device token used for trust + rate limiting. */
export function getDeviceToken(): string {
  try {
    let token = localStorage.getItem(KEY);
    if (!token) {
      token = crypto.randomUUID();
      localStorage.setItem(KEY, token);
    }
    return token;
  } catch {
    // Storage blocked (private mode): fall back to an ephemeral token.
    return "ephemeral";
  }
}
