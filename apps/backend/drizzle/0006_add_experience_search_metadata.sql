alter table public.items
  add column if not exists experience_search_query text,
  add column if not exists experience_location text;
