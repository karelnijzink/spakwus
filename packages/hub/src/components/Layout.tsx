// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { Link, NavLink, Outlet } from "react-router-dom";
import type { ReactNode } from "react";
import { brand } from "@nissegroup/shared";
import { useCorridorData } from "../offline/CorridorContext.js";
import { statusStyle } from "../lib/status.js";
import { OfflineBanner } from "./OfflineBanner.js";
import { DegradedBanner } from "./DegradedBanner.js";
import { ResurfacePrompt } from "./ResurfacePrompt.js";

function NavIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-5 w-5">
      {children}
    </svg>
  );
}

const HomeIcon = (
  <NavIcon>
    <path d="M3 11l9-7 9 7" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M5 10v9h14v-9" strokeLinecap="round" strokeLinejoin="round" />
  </NavIcon>
);
const MapIcon = (
  <NavIcon>
    <path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" strokeLinejoin="round" />
    <path d="M9 4v14M15 6v14" />
  </NavIcon>
);
const CommunityIcon = (
  <NavIcon>
    <path d="M7 8h10M7 12h6" strokeLinecap="round" />
    <path d="M4 5h16v11H9l-4 3v-3H4z" strokeLinejoin="round" />
  </NavIcon>
);
const AboutIcon = (
  <NavIcon>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" strokeLinecap="round" />
  </NavIcon>
);

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}
const NAV: NavItem[] = [
  { to: "/", label: "Home", icon: HomeIcon, end: true },
  { to: "/map", label: "Map", icon: MapIcon },
  { to: "/community", label: "Community", icon: CommunityIcon },
  { to: "/about", label: "About", icon: AboutIcon },
];

function Wordmark() {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      {/* The Spakwus mark (brand logo). Resolve against the Vite base so it loads
          under a subpath deploy (e.g. GitHub Pages at /spakwus/). */}
      <img
        src={`${import.meta.env.BASE_URL}${brand.logoPath.replace(/^\//, "")}`}
        alt=""
        aria-hidden
        className="h-8 w-8 rounded-lg"
      />
      <div className="flex items-baseline gap-2.5">
        <span className="text-xl font-bold tracking-tight text-ink">{brand.productName}</span>
        <span className="hidden pb-0.5 text-[10px] uppercase tracking-eyebrow text-ink-3 sm:inline">
          Sea&nbsp;to&nbsp;Sky
        </span>
      </div>
    </Link>
  );
}

function AlertsBell() {
  return (
    <NavLink to="/alerts" aria-label="Get alerts" className="text-ink-3 transition hover:text-pine">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-5 w-5">
        <path d="M6 9a6 6 0 1112 0c0 4 1.5 5 2 6H4c.5-1 2-2 2-6z" strokeLinejoin="round" />
        <path d="M10.5 20a1.5 1.5 0 003 0" strokeLinecap="round" />
      </svg>
    </NavLink>
  );
}

function Header() {
  const { snapshot } = useCorridorData();
  const status = snapshot?.corridor.status;
  const dot = status ? statusStyle(status).dot : "bg-ink-3";
  return (
    <header className="pt-safe sticky top-0 z-20 border-b border-edge bg-paper/90 backdrop-blur">
      <div className="mx-auto flex max-w-app items-center justify-between gap-6 px-4 py-3.5">
        <Wordmark />

        {/* Desktop navigation lives in the header; the bottom bar is mobile-only. */}
        <nav className="hidden flex-1 items-center justify-center gap-1 md:flex">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                  isActive ? "bg-pine/10 text-pine" : "text-ink-2 hover:text-ink"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          {status && (
            <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-ink-3">
              <span className={`h-2 w-2 rounded-full ${dot}`} />
              {statusStyle(status).label}
            </span>
          )}
          <AlertsBell />
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="space-y-2 border-t border-edge px-4 py-8 text-center">
      <a
        href={brand.publisherUrl}
        target="_blank"
        rel="noreferrer"
        className="block text-xs text-ink-3 transition hover:text-ink"
      >
        {brand.productName} is a product of{" "}
        <span className="font-medium text-ink-2">{brand.publisher}</span>
      </a>
      <p className="text-[11px] text-ink-3">
        <a href={`mailto:${brand.supportEmail}`} className="transition hover:text-ink">
          {brand.supportEmail}
        </a>
        <span aria-hidden className="mx-1.5">
          ·
        </span>
        <Link to="/history" className="transition hover:text-ink">
          History
        </Link>
        <span aria-hidden className="mx-1.5">
          ·
        </span>
        <Link to="/health" className="transition hover:text-ink">
          System status
        </Link>
      </p>
    </footer>
  );
}

function BottomNav() {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] uppercase tracking-wide transition ${
      isActive ? "text-pine" : "text-ink-3"
    }`;
  return (
    <nav className="pb-safe sticky bottom-0 z-20 border-t border-edge bg-paper-raised md:hidden">
      <div className="mx-auto flex max-w-content">
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={linkClass}>
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

export function Layout() {
  const { mode, generatedAt, confirmedAt } = useCorridorData();
  return (
    <div className="paper-grain flex min-h-dvh flex-col">
      <Header />
      {mode === "degraded" && <DegradedBanner confirmedAt={confirmedAt} />}
      {mode === "offline" && <OfflineBanner generatedAt={generatedAt} />}
      <main className="mx-auto w-full max-w-app flex-1 px-4 py-5 md:py-8">
        <Outlet />
      </main>
      <Footer />
      <BottomNav />
      <ResurfacePrompt />
    </div>
  );
}
