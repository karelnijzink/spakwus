// Copyright Nisse Group Ltd
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** Base URL of the core API. Same-origin "/api" by default (dev proxy / same host). */
  readonly VITE_API_BASE?: string;
  /** CDN URL of the static last-known-status fallback. "/status-fallback.json" by default. */
  readonly VITE_STATIC_FALLBACK_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
