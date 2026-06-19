insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'item-images',
  'item-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
--> statement-breakpoint
drop policy if exists "users select own item images" on storage.objects;
--> statement-breakpoint
create policy "users select own item images"
on storage.objects for select to authenticated
using (
  bucket_id = 'item-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);
--> statement-breakpoint
drop policy if exists "users insert own item images" on storage.objects;
--> statement-breakpoint
create policy "users insert own item images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'item-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);
--> statement-breakpoint
drop policy if exists "users update own item images" on storage.objects;
--> statement-breakpoint
create policy "users update own item images"
on storage.objects for update to authenticated
using (
  bucket_id = 'item-images'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'item-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);
--> statement-breakpoint
drop policy if exists "users delete own item images" on storage.objects;
--> statement-breakpoint
create policy "users delete own item images"
on storage.objects for delete to authenticated
using (
  bucket_id = 'item-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);
