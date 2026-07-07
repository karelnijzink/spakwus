// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Whether Web Push can work in this browser session (needs a service worker). */
export function webPushSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

/**
 * Request permission and create a push subscription against our VAPID key,
 * returning the subscription JSON string to send to the backend. Throws with a
 * user-friendly message on denial / unsupported.
 */
export async function subscribeWebPush(vapidPublicKey: string): Promise<string> {
  if (!webPushSupported()) throw new Error("Push isn't available in this browser.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications permission was denied.");

  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as unknown as BufferSource,
    }));
  return JSON.stringify(sub);
}
