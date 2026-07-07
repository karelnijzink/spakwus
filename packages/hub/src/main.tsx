// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App.js";
import { applyBrandTheme } from "./lib/brandTheme.js";
// Self-hosted brand font (bundled + precached for offline use).
import "@fontsource-variable/inter";
import "./index.css";

applyBrandTheme();

// Register the service worker (Workbox) for offline app-shell + installability.
registerSW({ immediate: true });

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
