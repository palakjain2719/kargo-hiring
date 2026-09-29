import { loadEnvFile } from "node:process"; loadEnvFile(".env.local");
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data } = await db.from("candidates").select("*").order("original_file_name");
const dg = (s) => (s || "").replace(/\D/g, "");
let issues = 0;
for (const c of data) {
  const a = c.anonymised_cv_content || "";
  const nameLeak = (c.private_name || "").split(/\s+/).filter(w => w.length >= 3).some(w => new RegExp(`\\b${w}\\b`, "i").test(a));
  const emailLeak = c.private_email && a.toLowerCase().includes(c.private_email.toLowerCase());
  const phoneLeak = c.private_phone && dg(a).includes(dg(c.private_phone).slice(-10));
  const anyEmail = /[\w.+-]+@[\w-]+\.[\w.]+/.test(a);
  const bad = nameLeak || emailLeak || phoneLeak || anyEmail;
  if (bad) issues++;
  console.log(`${c.original_file_name.padEnd(26)} ${c.applied_role.padEnd(3)} name:${c.private_name ? "Y" : "-"} email:${c.private_email ? "Y" : "-"} phone:${c.private_phone ? "Y" : "-"} | leak in AI text: ${bad ? "YES " + JSON.stringify({ nameLeak, emailLeak, phoneLeak, anyEmail }) : "none"} | ${a.length} chars`);
}
console.log(`\n${data.length} candidates, ${issues} with a leak`);
