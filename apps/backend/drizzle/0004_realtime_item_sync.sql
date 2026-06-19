do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'items'
  ) then
    alter publication supabase_realtime add table items;
  end if;
end $$;
--> statement-breakpoint
alter table realtime.messages enable row level security;
--> statement-breakpoint
drop policy if exists "users read own broadcast topic" on realtime.messages;
--> statement-breakpoint
create policy "users read own broadcast topic"
  on realtime.messages for select to authenticated
  using (
    (select auth.uid())::text = split_part(realtime.topic(), ':', 2)
    and realtime.messages.extension = 'broadcast'
  );
--> statement-breakpoint
drop policy if exists "users write own broadcast topic" on realtime.messages;
--> statement-breakpoint
create policy "users write own broadcast topic"
  on realtime.messages for insert to authenticated
  with check (
    (select auth.uid())::text = split_part(realtime.topic(), ':', 2)
    and realtime.messages.extension = 'broadcast'
  );
