import type { Role } from "../types";

export interface ParsedCriterion {
  role: Role;
  position: number;
  criterion_name: string;
  description: string;
  weight: number;
}

export class RubricError extends Error {}

const SECTION_HEADERS: Record<Role, RegExp> = {
  PM: /^PRODUCT MANAGER \(PM\)\s*$/m,
  SPM: /^SENIOR PRODUCT MANAGER \(SPM\)\s*$/m,
};

/**
 * Parses rubric.txt exactly as written. Nothing is invented or normalised:
 * criterion names, descriptions and weights come straight from the file.
 * Throws RubricError if the structure is unexpected or weights don't total 100.
 */
export function parseRubric(text: string): ParsedCriterion[] {
  const normalised = text.replace(/\r\n/g, "\n");
  const out: ParsedCriterion[] = [];

  for (const role of ["PM", "SPM"] as Role[]) {
    const header = SECTION_HEADERS[role].exec(normalised);
    if (!header) throw new RubricError(`Could not find the ${role} section header in rubric.txt`);
    const start = header.index + header[0].length;
    const totalMatch = /^TOTAL:\s*(\d+(?:\.\d+)?)%\s*$/m.exec(normalised.slice(start));
    if (!totalMatch) throw new RubricError(`Could not find "TOTAL:" line for ${role} section`);
    const section = normalised.slice(start, start + totalMatch.index);
    const declaredTotal = Number(totalMatch[1]);

    // Each criterion: "N. Name\nWhat a strong candidate looks like:\n<desc...>\nWeight: X%"
    const re = /^(\d+)\.\s+(.+?)\s*\n([\s\S]*?)^Weight:\s*(\d+(?:\.\d+)?)%\s*$/gm;
    const criteria: ParsedCriterion[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(section))) {
      const description = m[3]
        .replace(/^What a strong candidate looks like:\s*/m, "")
        .replace(/\s+/g, " ")
        .trim();
      if (!description) throw new RubricError(`${role} criterion ${m[1]} has no description`);
      criteria.push({
        role,
        position: Number(m[1]),
        criterion_name: m[2].trim(),
        description,
        weight: Number(m[4]),
      });
    }
    if (criteria.length === 0) throw new RubricError(`No criteria parsed for ${role}`);

    const sum = criteria.reduce((s, c) => s + c.weight, 0);
    if (Math.abs(sum - 100) > 1e-9) {
      throw new RubricError(
        `${role} weights sum to ${sum}%, not 100%. The rubric has not been changed — fix rubric.txt and re-seed.`,
      );
    }
    if (Math.abs(declaredTotal - 100) > 1e-9) {
      throw new RubricError(`${role} TOTAL line says ${declaredTotal}%, expected 100%.`);
    }
    out.push(...criteria);
  }
  return out;
}
