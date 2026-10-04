import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bantay Gubat — Forest Outpost 03",
  description:
    "IoT/ML illegal logging detection dashboard — live acoustic sensor monitoring for protected forest areas.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-[var(--background)] text-[var(--text)]">
        {children}
      </body>
    </html>
  );
}