import { createLocalRepo } from "./local";
import type { Repo } from "./repo";
import { createSupabaseRepo } from "./supabase";

let repo: Repo | null = null;

export function getRepo(): Repo {
  if (repo) return repo;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  repo = url && key ? createSupabaseRepo(url, key) : createLocalRepo();
  return repo;
}

export type { Repo } from "./repo";
