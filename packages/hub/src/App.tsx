// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { CorridorProvider } from "./offline/CorridorContext.js";
import { Layout } from "./components/Layout.js";
import { Home } from "./pages/Home.js";
import { MapPage } from "./pages/MapPage.js";
import { IncidentDetail } from "./pages/IncidentDetail.js";
import { About } from "./pages/About.js";
import { Admin } from "./pages/Admin.js";
import { Community } from "./pages/Community.js";
import { Health } from "./pages/Health.js";
import { History } from "./pages/History.js";
import { HAS_BACKEND } from "./lib/features.js";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The app must stay usable on flaky corridor connectivity; don't hammer.
      retry: 1,
      refetchOnReconnect: true,
    },
  },
});

const router = createBrowserRouter(
  [
    {
      element: <Layout />,
      children: [
        { path: "/", element: <Home /> },
        { path: "/map", element: <MapPage /> },
        { path: "/incident/:id", element: <IncidentDetail /> },
        { path: "/about", element: <About /> },
        // Backend-only routes (community board, moderation, and the
        // backend-health / history pages) are registered only when a backend is
        // configured — the static live site omits them.
        ...(HAS_BACKEND
          ? [
              { path: "/community", element: <Community /> },
              { path: "/history", element: <History /> },
              { path: "/health", element: <Health /> },
              { path: "/admin", element: <Admin /> },
            ]
          : []),
      ],
    },
  ],
  // Honour the Vite base path so routing works under a subpath (GitHub Pages).
  { basename: import.meta.env.BASE_URL.replace(/\/+$/, "") || "/" },
);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <CorridorProvider>
        <RouterProvider router={router} />
      </CorridorProvider>
    </QueryClientProvider>
  );
}
