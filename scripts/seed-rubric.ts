import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";
if (existsSync(".env.local")) loadEnvFile(".env.local");

const { seedRubric } = await import("../src/lib/rubric/seed");
const { getRepo } = await import("../src/lib/db");

try {
  const res = await seedRubric({ force: process.argv.includes("--force") });
  console.log(`Backend: ${getRepo().kind}. Rubric ${res.changed ? "seeded" : "already up to date"}.`);
  for (const role of ["PM", "SPM"] as const) {
    const rows = res.criteria.filter((c) => c.role === role);
    const total = rows.reduce((s, c) => s + c.weight, 0);
    console.log(`\n${role} (${rows.length} criteria, total ${total}%)`);
    for (const c of rows) console.log(`  ${c.position}. ${c.criterion_name}: ${c.weight}%`);
  }
} catch (e) {
  console.error(`\nRUBRIC NOT SEEDED: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
