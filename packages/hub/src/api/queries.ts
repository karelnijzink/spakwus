// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  fetchHealth,
  fetchHistoryStats,
  fetchIncidents,
  fetchRequests,
  type RequestFilter,
} from "./client.js";
import type { Incident } from "./types.js";

/** Active incidents (live from Open511). Keeps last-good data through blips. */
export function useIncidents(activeOnly = true) {
  return useQuery({
    queryKey: ["incidents", { activeOnly }],
    queryFn: () => fetchIncidents(activeOnly),
    refetchInterval: 45_000,
    refetchOnReconnect: true,
    retry: 3,
    retryDelay: (n) => Math.min(1000 * 2 ** n, 8000),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

/** Look up a single incident by id from the full (active + inactive) list. */
export function useIncident(id: string | undefined) {
  const query = useQuery({
    queryKey: ["incidents", { activeOnly: false }],
    queryFn: () => fetchIncidents(false),
    retry: 1,
    staleTime: 30_000,
    enabled: Boolean(id),
  });
  const incident: Incident | undefined = query.data?.incidents.find((i) => i.id === id);
  return { ...query, incident };
}

/** Public backend health + freshness. Polls briskly so the page feels live. */
export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    refetchInterval: 15_000,
    retry: 1,
    staleTime: 5_000,
  });
}

/** Historical corridor incident stats (retrospective; changes rarely). */
export function useHistoryStats() {
  return useQuery({
    queryKey: ["history-stats"],
    queryFn: fetchHistoryStats,
    retry: 1,
    staleTime: 60 * 60_000,
  });
}

/** Open community requests for a context (incident / segment / whole corridor). */
export function useRequests(filter: RequestFilter) {
  return useQuery({
    queryKey: ["requests", filter],
    queryFn: () => fetchRequests(filter),
    refetchInterval: 45_000,
    retry: 1,
    staleTime: 20_000,
  });
}
