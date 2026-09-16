"use client";

import { createClient } from "@/lib/supabase/client";
import { useState } from "react";

export default function GoogleLoginButton() {
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    try {
      setLoading(true);

      const supabase = createClient();

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) {
        console.error(error);
        setLoading(false);
      }
    } catch (error) {
      console.error(error);
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleLogin}
      disabled={loading}
      className="group flex w-full items-center justify-center gap-3 rounded-lg border border-[#34463a] bg-[#17221b] px-5 py-3 text-sm font-medium text-white transition-all duration-200 hover:border-[#536b59] hover:bg-[#1d2b22] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {/* Google Icon */}
      <svg
        width="19"
        height="19"
        viewBox="0 0 24 24"
        fill="none"
      >
        <path
          d="M21.35 12.2c0-.7-.06-1.4-.18-2H12v3.79h5.24a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.69 2.91-4.18 2.91-7.18Z"
          fill="#4285F4"
        />

        <path
          d="M12 21.5c2.63 0 4.84-.87 6.45-2.36l-3.14-2.45c-.87.58-1.98.92-3.31.92-2.54 0-4.69-1.72-5.46-4.03H3.29v2.53A9.75 9.75 0 0 0 12 21.5Z"
          fill="#34A853"
        />

        <path
          d="M6.54 13.58a5.86 5.86 0 0 1 0-3.76V7.29H3.29a9.74 9.74 0 0 0 0 8.82l3.25-2.53Z"
          fill="#FBBC05"
        />

        <path
          d="M12 5.79c1.43 0 2.71.49 3.72 1.45l2.79-2.79C16.83 2.91 14.63 2 12 2a9.75 9.75 0 0 0-8.71 5.29l3.25 2.53C7.31 7.51 9.46 5.79 12 5.79Z"
          fill="#EA4335"
        />
      </svg>

      {loading ? "Connecting..." : "Continue with Google"}
    </button>
  );
}