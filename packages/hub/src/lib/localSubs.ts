// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import type { NotifChannel, SubDirection, SubScope } from "../api/types.js";

const KEY = "spakwus:subscriptions";

export interface LocalSub {
  id: string;
  channel: NotifChannel;
  scope: SubScope;
  segmentId?: string | null;
  direction: SubDirection;
  unsubscribeToken: string;
  verified: boolean;
  label: string;
}

export function loadLocalSubs(): LocalSub[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as LocalSub[];
  } catch {
    return [];
  }
}

export function saveLocalSub(sub: LocalSub): void {
  try {
    const subs = loadLocalSubs().filter((s) => s.id !== sub.id);
    subs.push(sub);
    localStorage.setItem(KEY, JSON.stringify(subs));
  } catch {
    /* ignore */
  }
}

export function removeLocalSub(id: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadLocalSubs().filter((s) => s.id !== id)));
  } catch {
    /* ignore */
  }
}
