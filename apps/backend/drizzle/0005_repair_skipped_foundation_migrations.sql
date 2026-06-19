do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'items'
      and column_name = 'embedding'
  ) then
    alter table public.items add column embedding vector(1536);
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'items'
      and column_name = 'embedding_model'
  ) then
    alter table public.items add column embedding_model text;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'items_embedding_model_pair'
      and conrelid = 'public.items'::regclass
  ) then
    alter table public.items
      add constraint items_embedding_model_pair
      check ((embedding is null) = (embedding_model is null));
  end if;
end $$;
--> statement-breakpoint
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      nullif(split_part(coalesce(new.email, ''), '@', 1), '')
    ),
    coalesce(
      new.raw_user_meta_data->>'avatar_url',
      new.raw_user_meta_data->>'picture'
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
--> statement-breakpoint
do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'on_auth_user_created'
  ) then
    create trigger on_auth_user_created
      after insert on auth.users
      for each row execute function public.handle_new_auth_user();
  end if;
end $$;
--> statement-breakpoint
create or replace function public.handle_auth_user_updated()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.users
  set
    email        = new.email,
    display_name = coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      nullif(split_part(coalesce(new.email, ''), '@', 1), '')
    ),
    updated_at   = now()
  where id = new.id;
  return new;
end;
$$;
--> statement-breakpoint
do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'on_auth_user_updated'
  ) then
    create trigger on_auth_user_updated
      after update of email, raw_user_meta_data on auth.users
      for each row execute function public.handle_auth_user_updated();
  end if;
end $$;
