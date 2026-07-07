// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

const KEY = "spakwus:ownedRequests";

function load(): Set<string> {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

/** Track request ids this device created, so the poster can mark them matched/resolved. */
export function rememberOwnedRequest(id: string): void {
  try {
    const set = load();
    set.add(id);
    localStorage.setItem(KEY, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

export function isOwnedRequest(id: string): boolean {
  return load().has(id);
}
