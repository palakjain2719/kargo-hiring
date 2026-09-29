/** Fails if any secret value, or server-only env var name, appears in the client bundle. Run after `next build`. */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { loadEnvFile } from "node:process";
if (existsSync(".env.local")) loadEnvFile(".env.local");

const SECRET_VARS = ["SUPABASE_SERVICE_ROLE_KEY", "GEMINI_API_KEY", "RESEND_API_KEY", "DASHBOARD_PASSWORD", "CRON_SECRET", "SUPABASE_URL"];
const dir = ".next/static";
if (!existsSync(dir)) { console.error("Run `npm run build` first."); process.exit(1); }
const files: string[] = [];
const walk = (d: string) => readdirSync(d).forEach((f) => { const p = path.join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); });
walk(dir);
const needles = [
  ...SECRET_VARS,
  ...SECRET_VARS.map((k) => process.env[k]).filter((v): v is string => !!v && v.length >= 8),
  "@google/genai", "generativelanguage.googleapis.com", "api.resend.com", "service_role",
];
let bad = 0;
for (const f of files) {
  const text = readFileSync(f, "utf8");
  for (const n of needles) if (text.includes(n)) { console.error(`LEAK: "${n.slice(0, 12)}…" found in ${f}`); bad++; }
}
const ignored = readFileSync(".gitignore", "utf8").split("\n").includes(".env.local");
console.log(`.env.local git-ignored: ${ignored ? "yes" : "NO"}`);
console.log(bad || !ignored ? `FAILED (${bad} leaks)` : `OK: scanned ${files.length} client files, no secrets or server SDKs found.`);
process.exit(bad || !ignored ? 1 : 0);
