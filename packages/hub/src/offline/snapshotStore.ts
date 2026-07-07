// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { openDB, type IDBPDatabase } from "idb";
import type { SnapshotResponse } from "../api/types.js";

const DB_NAME = "spakwus";
const DB_VERSION = 1;
const STORE = "snapshot";
const KEY = "latest";

export interface StoredSnapshot {
  snapshot: SnapshotResponse;
  /** When this snapshot was fetched and stored on the device (ISO). */
  fetchedAt: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      },
    });
  }
  return dbPromise;
}

/** Persist the latest snapshot to IndexedDB (called on every successful fetch). */
export async function saveSnapshot(snapshot: SnapshotResponse): Promise<void> {
  try {
    const db = await getDb();
    const stored: StoredSnapshot = { snapshot, fetchedAt: new Date().toISOString() };
    await db.put(STORE, stored, KEY);
  } catch {
    // IndexedDB may be unavailable (private mode, etc.); offline cache is best-effort.
  }
}

/** Load the last cached snapshot, or undefined if none has been stored yet. */
export async function loadSnapshot(): Promise<StoredSnapshot | undefined> {
  try {
    const db = await getDb();
    return (await db.get(STORE, KEY)) as StoredSnapshot | undefined;
  } catch {
    return undefined;
  }
}
