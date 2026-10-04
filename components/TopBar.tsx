"use client";

import { createClient } from "@/lib/supabase/client";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function TopBar() {
  const router = useRouter();

  const [darkMode, setDarkMode] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const savedTheme = localStorage.getItem("theme");

    if (savedTheme === "light") {
      document.documentElement.classList.remove("dark");
      setDarkMode(false);
    } else {
      document.documentElement.classList.add("dark");
      setDarkMode(true);
    }

    setMounted(true);
  }, []);

  const toggleTheme = () => {
    const html = document.documentElement;

    if (html.classList.contains("dark")) {
      html.classList.remove("dark");
      localStorage.setItem("theme", "light");
      setDarkMode(false);
    } else {
      html.classList.add("dark");
      localStorage.setItem("theme", "dark");
      setDarkMode(true);
    }
  };

  const handleLogout = async () => {
    const supabase = createClient();

    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error("Logout error:", error);
      return;
    }

    router.replace("/");
    router.refresh();
  };

  return (
    <header
      className="
        flex h-14 shrink-0 items-center justify-between px-5
        border-b border-[var(--border)]
        bg-[var(--panel)]
      "
    >
      {/* Page Title */}
      <h1 className="text-base font-semibold tracking-tight text-[var(--text)]">
        Live Map
      </h1>

      <div className="flex items-center gap-5 text-[10px]">

        {/* Nodes Online */}
        <div className="flex items-center gap-2">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: "var(--status-online)" }}
          />

          <span className="text-[var(--text-muted)]">
            3/3 NODES ONLINE
          </span>
        </div>

        {/* Latency */}
        <div className="flex items-center gap-2">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: "var(--status-warning)" }}
          />

          <span className="text-[var(--text-muted)]">
            LATENCY
          </span>

          <span className="text-[var(--text)]">
            18.4s
          </span>
        </div>

        {/* Time */}
        <span
          className="font-mono"
          style={{ color: "var(--accent)" }}
        >
          02:47:19 PHT
        </span>

        {/* Theme Toggle */}
        {mounted && (
          <button
            onClick={toggleTheme}
            aria-label={
              darkMode
                ? "Switch to light mode"
                : "Switch to dark mode"
            }
            title={
              darkMode
                ? "Switch to light mode"
                : "Switch to dark mode"
            }
            className="
              flex h-8 w-8 items-center justify-center rounded-md
              border border-[var(--border)]
              text-[var(--text-muted)]
              transition
              hover:border-[var(--accent)]
              hover:text-[var(--text)]
            "
          >
            {darkMode ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        )}

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="
            rounded border border-[var(--border)]
            px-3 py-1.5
            text-[var(--text-muted)]
            transition
            hover:border-[var(--accent)]
            hover:text-[var(--text)]
          "
        >
          Logout
        </button>

      </div>
    </header>
  );
}