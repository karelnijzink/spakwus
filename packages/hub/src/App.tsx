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
import { Alerts } from "./pages/Alerts.js";
import { Health } from "./pages/Health.js";
import { History } from "./pages/History.js";

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
        { path: "/community", element: <Community /> },
        { path: "/alerts", element: <Alerts /> },
        { path: "/incident/:id", element: <IncidentDetail /> },
        { path: "/about", element: <About /> },
        { path: "/history", element: <History /> },
        { path: "/health", element: <Health /> },
        { path: "/admin", element: <Admin /> },
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
