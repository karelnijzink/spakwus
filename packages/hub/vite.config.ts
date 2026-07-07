// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { brand } from "@nissegroup/shared";

// Spakwus hub (PWA frontend) — Vite + React + Workbox config.
// Manifest name, theme colour and icons are driven by the shared brand config.
// `VITE_BASE` lets us build under a subpath (e.g. "/spakwus/" for GitHub Pages
// project pages); it defaults to "/" for root/same-origin deploys.
export default defineConfig(() => {
  const base = process.env.VITE_BASE ?? "/";
  return {
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["brand/logo.svg", "apple-touch-icon.png"],
      manifest: {
        name: brand.productName,
        short_name: brand.productName,
        description: brand.tagline,
        start_url: base,
        scope: base,
        display: "standalone",
        orientation: "portrait",
        background_color: "#f3efe5", // cream paper (splash)
        theme_color: brand.colors.theme, // pine, from brand config
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
          { src: "brand/logo.svg", sizes: "any", type: "image/svg+xml" },
        ],
      },
      workbox: {
        // Precache the app shell (JS/CSS/HTML/SVG built assets).
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: `${base}index.html`,
        // Push + notification-click handlers for Web Push.
        importScripts: ["push-listener.js"],
        runtimeCaching: [
          {
            // Opportunistically cache corridor map tiles (free OSM raster).
            urlPattern: ({ url }) => url.origin === "https://tile.openstreetmap.org",
            handler: "CacheFirst",
            options: {
              cacheName: "spakwus-map-tiles",
              expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Opportunistically cache DriveBC cam stills (live host + legacy host).
            urlPattern: ({ url }) =>
              (url.hostname === "www.drivebc.ca" && url.pathname.startsWith("/images/")) ||
              url.hostname === "images.drivebc.ca",
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "spakwus-cam-thumbs",
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  };
});
