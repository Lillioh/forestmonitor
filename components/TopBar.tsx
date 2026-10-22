"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAlerts } from "@/context/AlertsContext";
import { NAV_ITEMS, titleForPathname } from "@/lib/nav";
import { formatClockTime } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import Link from "next/link";

function subscribeTheme(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener("forest-theme", listener);
  return () => { window.removeEventListener("storage", listener); window.removeEventListener("forest-theme", listener); };
}
const themeSnapshot = () => localStorage.getItem("theme") !== "light";

export default function TopBar() {
  const router = useRouter();
  const pathname = usePathname();
  const { sensors, user, connected, readOnly } = useAlerts();
  const now = useNow();
  const darkMode = useSyncExternalStore(subscribeTheme, themeSnapshot, () => true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { document.documentElement.classList.toggle("dark", darkMode); }, [darkMode]);

  async function logout() {
    setLoggingOut(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!response.ok) throw new Error("Unable to sign out. Please try again.");
      router.replace("/");
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to reach the outpost server.");
      setLoggingOut(false);
    }
  }

  return (
    <>
      <header className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--panel)] px-5 py-2">
        <h1 className="text-base font-semibold text-[var(--text)]">{titleForPathname(pathname)}</h1>
        <div className="flex flex-wrap items-center gap-4 text-[10px]">
          <span className="text-[var(--text-muted)]">{sensors.filter((n) => n.status === "ONLINE").length}/{sensors.length} NODES ONLINE</span>
          <span className="text-[var(--text-muted)]">{connected ? readOnly ? "CLOUD VIEW CONNECTED" : "LOCAL SERVER CONNECTED" : "RECONNECTING"}</span>
          <span className="font-mono text-[var(--accent)]">{now ? `${formatClockTime(new Date(now))} PHT` : "--:--:-- PHT"}</span>
          <span className="text-[var(--text-muted)]">{user.name}</span>
          <button onClick={() => { localStorage.setItem("theme", darkMode ? "light" : "dark"); window.dispatchEvent(new Event("forest-theme")); }} aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"} className="rounded-md border border-[var(--border)] p-2 text-[var(--text-muted)]">
            {darkMode ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button onClick={logout} disabled={loggingOut} className="rounded border border-[var(--border)] px-3 py-1.5 text-[var(--text-muted)] disabled:opacity-50">{loggingOut ? "Signing out…" : "Logout"}</button>
        </div>
      </header>
      {error && <p role="alert" className="bg-red-100 px-5 py-2 text-xs text-red-950">{error}</p>}
      <nav aria-label="Mobile navigation" className="flex shrink-0 gap-3 overflow-x-auto border-b border-[var(--border)] bg-[var(--panel)] px-4 py-3 text-xs md:hidden">
        {NAV_ITEMS.map((item) => <Link key={item.href} href={item.href} className={`whitespace-nowrap ${pathname.startsWith(item.href) ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}`}>{item.label}</Link>)}
      </nav>
    </>
  );
}
