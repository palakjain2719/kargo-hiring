-- Best-fit role assignment and automatic finalists.
-- role_source: 'applicant' = role stated by/for the applicant; 'best_fit' = assigned from rubric scores.
alter table candidates add column if not exists role_source text not null default 'applicant'
  check (role_source in ('applicant', 'best_fit'));
-- true once the founder has made any manual status decision; auto-finalisting never overrides it.
alter table candidates add column if not exists decided_by_founder boolean not null default false;
insert into settings (key, value) values ('finalist_count', '3'::jsonb) on conflict (key) do nothing;
