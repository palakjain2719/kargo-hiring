"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ShortlistSettings({ role, size, minScore }: { role: "PM" | "SPM"; size: number; minScore: number }) {
  const router = useRouter();
  const [n, setN] = useState(size);
  const [min, setMin] = useState(minScore);
  const [saving, setSaving] = useState(false);
  const dirty = n !== size || min !== minScore;
  return (
    <div className="flex items-end gap-2">
      <label className="flex flex-col gap-0.5">
        <span className="label">Shortlist size</span>
        <input type="number" min={1} max={100} className="input w-20" value={n} onChange={(e) => setN(Number(e.target.value))} />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="label">Min. score</span>
        <input type="number" min={0} max={100} className="input w-20" value={min} onChange={(e) => setMin(Number(e.target.value))} />
      </label>
      <button
        className="btn"
        disabled={!dirty || saving}
        onClick={async () => {
          setSaving(true);
          await fetch("/api/settings", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ shortlist_size: { [role]: n }, min_recommend_score: min }),
          });
          setSaving(false);
          router.refresh();
        }}
      >
        Update
      </button>
    </div>
  );
}
