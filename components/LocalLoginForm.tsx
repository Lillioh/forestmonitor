"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole, UserRound } from "lucide-react";

export default function LocalLoginForm({ hasAccounts }: { hasAccounts: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: data.get("username"), password: data.get("password") }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to sign in.");
      router.replace("/dashboard");
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to reach the outpost server.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={login} className="space-y-4">
      {!hasAccounts && <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-xs leading-5 text-amber-200">No accounts have been provisioned. Ask the outpost administrator to create your account.</p>}
      <label className="block text-xs text-[#9aac9e]">
        Username
        <span className="mt-2 flex items-center gap-2 rounded-lg border border-[#34463a] bg-[#101a14] px-3">
          <UserRound size={16} aria-hidden="true" />
          <input name="username" autoComplete="username" required minLength={3} maxLength={40} disabled={loading || !hasAccounts} className="min-w-0 flex-1 bg-transparent py-3 text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-[#8fb593]" />
        </span>
      </label>
      <label className="block text-xs text-[#9aac9e]">
        Password
        <span className="mt-2 flex items-center gap-2 rounded-lg border border-[#34463a] bg-[#101a14] px-3">
          <LockKeyhole size={16} aria-hidden="true" />
          <input name="password" type="password" autoComplete="current-password" required maxLength={128} disabled={loading || !hasAccounts} className="min-w-0 flex-1 bg-transparent py-3 text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-[#8fb593]" />
        </span>
      </label>
      {error && <p role="alert" className="text-xs leading-5 text-red-300">{error}</p>}
      <button type="submit" disabled={loading || !hasAccounts} className="w-full rounded-lg border border-[#536b59] bg-[#294232] px-5 py-3 text-sm font-semibold text-white hover:bg-[#35523e] disabled:cursor-not-allowed disabled:opacity-50">
        {loading ? "Signing in…" : "Sign in to outpost"}
      </button>
    </form>
  );
}
