// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { createContext, useContext, type ReactNode } from "react";
import { useCorridor, type CorridorView } from "./useCorridor.js";

const CorridorContext = createContext<CorridorView | null>(null);

/** Runs the corridor snapshot query once and shares it across the whole app. */
export function CorridorProvider({ children }: { children: ReactNode }) {
  const view = useCorridor();
  return <CorridorContext.Provider value={view}>{children}</CorridorContext.Provider>;
}

export function useCorridorData(): CorridorView {
  const ctx = useContext(CorridorContext);
  if (!ctx) throw new Error("useCorridorData must be used within a CorridorProvider");
  return ctx;
}
