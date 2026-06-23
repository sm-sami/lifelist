alter table public.items
  add column if not exists canonical_title text,
  add column if not exists semantic_key text,
  add column if not exists semantic_data jsonb,
  add column if not exists semantic_confidence real,
  add column if not exists semantic_version integer,
  add column if not exists normalizer_model text;

create unique index if not exists items_user_semantic_key_unique_idx
  on public.items (user_id, semantic_key)
  where semantic_key is not null;

create table if not exists public.item_analysis_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title_hash text not null,
  semantic_data jsonb not null,
  semantic_key text,
  embedding vector(1536) not null,
  embedding_model text not null,
  analysis_model text not null,
  analysis_version integer not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create unique index if not exists item_analysis_cache_user_title_unique_idx
  on public.item_analysis_cache (user_id, title_hash);
create index if not exists item_analysis_cache_expires_idx
  on public.item_analysis_cache (expires_at);

alter table public.item_analysis_cache enable row level security;
revoke all privileges on table public.item_analysis_cache from anon, authenticated;
