import type { Metadata } from "next";
import Link from "next/link";
import { isMockAi } from "@/lib/ai/providers";
import { sendingEnabled } from "@/lib/email/send";
import "./globals.css";

export const metadata: Metadata = { title: "Kargo Hiring", robots: { index: false, follow: false } };

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/upload", label: "Upload & processing" },
  { href: "/shortlist/PM", label: "PM shortlist" },
  { href: "/shortlist/SPM", label: "SPM shortlist" },
  { href: "/finalists", label: "Finalists" },
  { href: "/communications", label: "Communications" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const localDb = !(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const mockAi = isMockAi();
  const live = sendingEnabled();
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-[1320px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
            <Link href="/" className="text-[15px] font-semibold tracking-tight">
              Kargo Hiring
            </Link>
            <nav className="flex flex-wrap gap-1">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="rounded-md px-2.5 py-1 text-[13px] text-ink-2 hover:bg-canvas hover:text-ink">
                  {n.label}
                </Link>
              ))}
            </nav>
            <span className={`ml-auto rounded border px-2 py-0.5 text-[11px] font-medium ${live ? "border-bad/30 bg-bad-soft text-bad" : "border-line text-ink-3"}`}>
              {live ? "Email sending LIVE" : "Email sending off (dry run)"}
            </span>
          </div>
          {(localDb || mockAi) && (
            <div className="border-t border-warn/20 bg-warn-soft">
              <div className="mx-auto max-w-[1320px] px-4 py-1.5 text-xs text-warn sm:px-6">
                Development mode:{" "}
                {[localDb && "local file store instead of Supabase", mockAi && "MOCK AI (keyword heuristic, not a real assessment). Set GEMINI_API_KEY for real scoring"]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
          )}
        </header>
        <main className="mx-auto max-w-[1320px] px-4 py-6 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
