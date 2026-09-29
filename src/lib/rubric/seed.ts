import { readFileSync } from "node:fs";
import path from "node:path";
import { getRepo } from "../db";
import { parseRubric } from "./parse";

/**
 * Seeds rubric_criteria from rubric.txt: one row per criterion per role.
 * parseRubric throws (and nothing is written) if weights don't total 100% per role.
 * Refuses to re-seed once candidates have been scored, because scores reference criterion IDs.
 */
export async function seedRubric(opts: { force?: boolean } = {}) {
  const file = process.env.RUBRIC_PATH || path.join(process.cwd(), "rubric.txt");
  const parsed = parseRubric(readFileSync(file, "utf8"));
  const repo = getRepo();
  const existing = await repo.listCriteria();
  const same =
    existing.length === parsed.length &&
    parsed.every((p) =>
      existing.some(
        (e) => e.role === p.role && e.position === p.position && e.criterion_name === p.criterion_name && e.description === p.description && e.weight === p.weight,
      ),
    );
  if (same) return { changed: false, criteria: existing };
  if (existing.length && (await repo.listScores()).length && !opts.force) {
    throw new Error("rubric.txt differs from the seeded rubric but candidates are already scored. Re-run with --force and re-score everyone.");
  }
  await repo.replaceCriteria(parsed);
  await repo.addAudit({ candidate_id: null, action: "rubric_seeded", actor: "system", details: { rows: parsed.length } });
  return { changed: true, criteria: await repo.listCriteria() };
}
