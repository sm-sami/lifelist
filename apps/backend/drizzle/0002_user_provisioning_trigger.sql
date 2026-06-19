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
  );
  return new;
end;
$$;
--> statement-breakpoint
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
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
create trigger on_auth_user_updated
  after update of email, raw_user_meta_data on auth.users
  for each row execute function public.handle_auth_user_updated();
