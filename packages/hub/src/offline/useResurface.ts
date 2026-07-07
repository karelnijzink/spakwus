// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { useEffect, useRef, useState } from "react";

/**
 * Resurface capture: watch the browser's online/offline events (the same signal
 * the service worker uses) and fire when the app regains connectivity after a
 * stretch offline — i.e. the user has just driven through a dead zone in the
 * corridor. That's the moment to ask "anything to report?".
 */
export function useResurface(thresholdMs = 90_000): { prompted: boolean; dismiss: () => void } {
  const [prompted, setPrompted] = useState(false);
  const offlineSince = useRef<number | null>(null);

  useEffect(() => {
    const onOffline = () => {
      offlineSince.current = Date.now();
    };
    const onOnline = () => {
      const since = offlineSince.current;
      offlineSince.current = null;
      if (since !== null && Date.now() - since >= thresholdMs) {
        setPrompted(true);
      }
    };

    // If we start offline, begin the timer immediately.
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      offlineSince.current = Date.now();
    }

    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [thresholdMs]);

  return { prompted, dismiss: () => setPrompted(false) };
}
