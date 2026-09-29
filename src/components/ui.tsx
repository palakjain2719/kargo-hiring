import type { ReactNode } from "react";

export function scoreTone(score: number | null | undefined) {
  if (score == null) return "text-ink-3";
  if (score >= 70) return "text-good";
  if (score >= 50) return "text-warn";
  return "text-bad";
}

export function Score({ value, size = "md" }: { value: number | null | undefined; size?: "md" | "lg" }) {
  if (value == null) return <span className="text-ink-3">—</span>;
  return (
    <span className={`font-semibold tabular-nums ${scoreTone(value)} ${size === "lg" ? "text-2xl" : ""}`}>
      {value.toFixed(value % 1 === 0 ? 0 : 1)}
      {size === "lg" && <span className="text-sm font-normal text-ink-3">/100</span>}
    </span>
  );
}

/** 0–5 criterion score as five pips. */
export function Pips({ score }: { score: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${score} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`h-2 w-3 rounded-sm ${i <= score ? (score >= 4 ? "bg-good" : score >= 3 ? "bg-warn" : "bg-bad") : "bg-line"}`} />
      ))}
    </span>
  );
}

const STATUS_TONE: Record<string, string> = {
  Processing: "bg-canvas text-ink-2 border-line",
  Queued: "bg-canvas text-ink-2 border-line",
  Analysed: "bg-accent-soft text-accent border-accent/20",
  Shortlisted: "bg-warn-soft text-warn border-warn/20",
  Finalist: "bg-[#f3eefe] text-[#6a3fc9] border-[#6a3fc9]/20",
  Selected: "bg-good-soft text-good border-good/20",
  Rejected: "bg-canvas text-ink-2 border-line",
  Failed: "bg-bad-soft text-bad border-bad/20",
};

export function StatusBadge({ label }: { label: string }) {
  const [base, comm] = label.split(" · ");
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-medium ${STATUS_TONE[base] ?? STATUS_TONE.Processing}`}>{base}</span>
      {comm && (
        <span
          className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-medium ${
            comm === "Sent" ? "border-good/20 bg-good-soft text-good" : comm === "Send Failed" ? "border-bad/20 bg-bad-soft text-bad" : "border-line bg-surface text-ink-2"
          }`}
        >
          {comm}
        </span>
      )}
    </span>
  );
}

export function RecBadge({ rec }: { rec: string }) {
  const tone =
    rec === "Recommend shortlist" ? "text-good" : rec === "Borderline" ? "text-warn" : "text-ink-3";
  return <span className={`text-xs font-medium ${tone}`}>{rec}</span>;
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {sub && <p className="mt-0.5 text-[13px] text-ink-2">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, href }: { label: string; value: number; href?: string }) {
  const inner = (
    <>
      <div className="label">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </>
  );
  return href ? (
    <a href={href} className="card block px-4 py-3 hover:border-accent/40">
      {inner}
    </a>
  ) : (
    <div className="card px-4 py-3">{inner}</div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="card px-6 py-10 text-center text-[13px] text-ink-2">{children}</div>;
}
