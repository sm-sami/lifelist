# Integration 002 — Media Pipeline: Supabase Storage

> Integration phase 2. Lets a user attach a custom photo to an item: pick from the
> device with `expo-image-picker`, upload the binary to a PRIVATE Supabase Storage bucket
> as an `ArrayBuffer` under a NEW versioned object path, then PATCH that path onto the
> item via Hono. The backend atomically swaps the DB pointer and cleans up the replaced
> object. Reads use backend-minted short-lived signed URLs. Includes the Storage RLS policies that secure the
> direct-from-client upload path.

---

## 🎯 Objective

1. Orchestrate `expo-image-picker` → device file → upload pipeline, with client-side
   size/MIME validation and user-facing error/permission state + retry.
2. Upload the image **directly** to a PRIVATE Supabase Storage bucket from the client
   (bypassing Hono for the binary) to a NEW UUID-versioned object path as an
   `ArrayBuffer` with an explicit content type.
3. Tie the new object PATH back to the item via `PATCH /api/items/:id/image`. The backend
   validates ownership, locks the row, swaps the pointer, and best-effort deletes the
   replaced private object. On PATCH failure the client deletes only the new uncommitted
   upload.
4. Return images through the canonical backend DTO mapper, which mints short-lived signed
   URLs for private paths.
5. Lock the bucket down with **RLS / storage policies** so a user can only access their
   own folder — this is the real security boundary because the upload skips Hono's JWT
   middleware.

---

## 💻 Code & Configuration Blueprints

### 1. Dependencies

```bash
# Scope installs to the mobile workspace (NOT the root) — these are Expo app deps.
pnpm --filter mobile expo install expo-image-picker expo-file-system expo-crypto
```

### 2. Create the bucket + RLS policies (Supabase SQL)

```sql
-- storage_setup.sql  (idempotent / migration-safe — safe to re-run)
-- 1. Create the item-images bucket with explicit constraints.
--    PRIVACY DECISION: this bucket is PRIVATE (`public => false`). Item card art is
--    served via short-lived signed URLs (`createSignedUrl(path, ttl)`) minted on read.
--    This is the chosen secure posture: the bucket is never world-readable, so a leaked
--    object path is useless without a fresh signed URL, and every read is scoped to the
--    owner's JWT through the SELECT policy below. file_size_limit + allowed_mime_types
--    reject oversized / non-image uploads at the storage layer (defense in depth — the
--    client also validates BEFORE upload).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'item-images', 'item-images', false,                -- PRIVATE bucket
  5242880,                                            -- 5 MB cap
  array['image/jpeg', 'image/png', 'image/webp']      -- only these MIME types
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2. RLS: a user may SELECT/INSERT/UPDATE/DELETE only objects under their own uid folder.
--    Path convention: item-images/<auth.uid()>/<itemId>/<version>.<ext>  (versioned)
--    storage.foldername(name)[1] is the first path segment (the user id).
--    NOTE: a SELECT policy is REQUIRED — `createSignedUrl` and the upload client's
--    existence checks both read the object, so without SELECT signing/list calls fail.
--    Policy creation is made idempotent with `drop policy if exists` so the migration is
--    safe to re-run.

drop policy if exists "users select own item images" on storage.objects;
create policy "users select own item images"
on storage.objects for select to authenticated
using (
  bucket_id = 'item-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "users insert own item images" on storage.objects;
create policy "users insert own item images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'item-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- UPDATE needs BOTH a USING (which existing rows may be updated) and a WITH CHECK
-- (the row AFTER update must still be in the owner's folder) — without WITH CHECK a
-- client could update an owned object's path INTO another shape. Keep both.
drop policy if exists "users update own item images" on storage.objects;
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

drop policy if exists "users delete own item images" on storage.objects;
create policy "users delete own item images"
on storage.objects for delete to authenticated
using (
  bucket_id = 'item-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- There is NO anonymous/public read: the bucket is private. All reads go through a signed
-- URL minted under the owner's JWT, which the owner-scoped SELECT policy authorizes.
```

> Because the Expo app uploads with the user's publishable key + JWT (not the secret key),
> these policies are what actually prevent user A from accessing user B's folder. Hono
> never sees the binary, so RLS — not the JWT middleware — is the guard here. The
> owner-scoped **SELECT** policy is required for both `createSignedUrl` (private read) and
> the upload client's existence checks; without it those calls fail with an RLS error.

### 3. Image picker + upload pipeline — `lib/media/uploadItemImage.ts`

```ts
// lib/media/uploadItemImage.ts
import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";
import { randomUUID } from "expo-crypto";
import { supabase } from "@/lib/supabase";

const BUCKET = "item-images";
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — must match the bucket's file_size_limit
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;

/** A picker result that already passed client-side size/MIME validation. */
export class MediaValidationError extends Error {}
/** The user denied photo-library permission. */
export class MediaPermissionError extends Error {}

export interface UploadResult {
  /** The NEW versioned object key, e.g. `<uid>/<itemId>/<version>.<ext>`. */
  path: string;
}

/** Opens the picker (portrait crop), returns the local asset or null if cancelled. */
export async function pickImage(): Promise<ImagePicker.ImagePickerAsset | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new MediaPermissionError("Media library permission denied");

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    aspect: [3, 4], // portrait, matches card art
    quality: 0.85,
  });
  if (result.canceled || !result.assets[0]) return null;
  return result.assets[0];
}

function extFromMime(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  return "jpg";
}

/**
 * CLIENT-SIDE VALIDATION (runs BEFORE upload — defense in depth with the bucket limits).
 * Rejects non-image MIME types and oversized files so we never burn an upload round-trip
 * (or hit a storage-layer rejection) on a file the bucket would refuse anyway.
 * Returns the validated content-type.
 */
async function validateAsset(asset: ImagePicker.ImagePickerAsset): Promise<string> {
  const contentType = (asset.mimeType ?? "image/jpeg").toLowerCase();
  if (!ALLOWED_MIME.includes(contentType as (typeof ALLOWED_MIME)[number])) {
    throw new MediaValidationError("Unsupported image type (use JPEG, PNG, or WebP).");
  }
  // SDK 56 File API: prefer picker metadata and fall back to the local File object.
  const size = asset.fileSize ?? new File(asset.uri).size;
  if (!Number.isFinite(size) || size <= 0) {
    throw new MediaValidationError("Could not read the selected image.");
  }
  if (size > MAX_BYTES) {
    throw new MediaValidationError("Image is too large (max 5 MB).");
  }
  return contentType;
}

/**
 * Uploads a picked asset to the PRIVATE Supabase Storage bucket under a NEW VERSIONED
 * object path. It does NOT delete any previous object and does NOT touch the DB — the
 * caller PATCHes the returned path. The SDK 56 File API provides `arrayBuffer()`
 * directly; upload that binary with an explicit content type.
 */
export async function uploadItemImage(
  userId: string,
  itemId: string,
  asset: ImagePicker.ImagePickerAsset,
): Promise<UploadResult> {
  const contentType = await validateAsset(asset);
  const ext = extFromMime(contentType);

  // VERSIONED path: a UUID makes every upload a NEW object key, even across devices.
  // Because the path itself changes per upload, cache-busting is inherent — there is NO
  // `?v=` query string (the backend image-URL regex rejects query strings; see §4).
  const version = randomUUID();
  const path = `${userId}/${itemId}/${version}.${ext}`; // matches the RLS folder convention

  const arrayBuffer = await new File(asset.uri).arrayBuffer();

  // 3: upload the binary with explicit content-type. NO upsert — the path is brand new
  //    every time, so we never overwrite (and never need a destructive overwrite check).
  const { error } = await supabase.storage.from(BUCKET).upload(path, arrayBuffer, {
    contentType,
    upsert: false,
  });
  if (error) throw error;

  return { path };
}

/** Roll back a newly-uploaded object when the API PATCH fails. */
export async function deleteItemImageObject(path: string): Promise<void> {
  // remove() ignores keys that don't exist, so this is safe to call unconditionally.
  await supabase.storage.from(BUCKET).remove([path]);
}

```

### 4. Harden the canonical backend image endpoint

Do not create a second implementation here. Implement the single
`PATCH /api/items/:id/image` contract defined in backend/004:

- Accept only `<uid>/<itemId>/<uuid-v4>.<jpg|jpeg|png|webp>`.
- Confirm the uploaded object exists before changing the database pointer.
- Lock the owner-scoped item row before replacing `image_url`.
- Commit the new path before deleting anything.
- After commit, use the backend secret-key Storage client to best-effort delete the
  previous private object path; never delete an external URL.
- Return the canonical `ItemDto`, so `imageUrl` is already a signed URL. The client never
  receives or tries to reverse-engineer the previous private path.

### 5. Client wrapper — `lib/api/items.ts` (addition)

```ts
// lib/api/items.ts (addition)
import { apiJson } from "@/lib/api/client";
import { ItemDtoSchema } from "@lifelist/shared";
import type { Item } from "@/store/types";

/** PATCH the new object PATH onto the item; RUNTIME-VALIDATE the response DTO. */
export async function setItemImage(itemId: string, imagePath: string): Promise<Item> {
  const { item } = await apiJson<{ item: unknown }>(`/items/${itemId}/image`, {
    method: "PATCH",
    body: JSON.stringify({ imagePath }),
  });
  // Don't trust the wire — parse with the canonical schema before it enters the store.
  return ItemDtoSchema.parse(item);
}
```

### 6. Full UI flow — `components/ChangePhotoButton.tsx`

```tsx
// components/ChangePhotoButton.tsx
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import {
  pickImage,
  uploadItemImage,
  deleteItemImageObject,
  MediaPermissionError,
  MediaValidationError,
} from "@/lib/media/uploadItemImage";
import { setItemImage } from "@/lib/api/items";
import { useItemsStore } from "@/store/items";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/useTheme";

export function ChangePhotoButton({ itemId }: { itemId: string }) {
  // Read theme tokens in the BODY (never `import { theme }`) so light/dark both work.
  const { colors, radius } = useTheme();
  const { session } = useAuth();
  const upsert = useItemsStore((s) => s.upsert);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPress() {
    if (!session || busy) return;
    setError(null);
    // Set busy BEFORE launching the picker so the button is un-tappable while the picker
    // opens (otherwise a double-tap can fire two pickers/uploads). Reset in finally.
    setBusy(true);
    let uploadedPath: string | null = null;
    try {
      const asset = await pickImage();
      if (!asset) return; // user cancelled — finally resets busy

      // 1. Upload to a NEW versioned path.
      const { path } = await uploadItemImage(session.user.id, itemId, asset);
      uploadedPath = path;

      // 2. PATCH the DB to the NEW path. The backend owns previous-object cleanup.
      const updated = await setItemImage(itemId, path);
      upsert(updated); // reflect new image in store → card + detail update

      uploadedPath = null; // committed — don't roll back
    } catch (e) {
      // Roll back a just-uploaded object if the PATCH (or anything after upload) failed.
      if (uploadedPath) {
        await deleteItemImageObject(uploadedPath).catch(() => {});
      }
      if (e instanceof MediaPermissionError) {
        setError("Photo access denied. Enable it in Settings, then retry.");
      } else if (e instanceof MediaValidationError) {
        setError(e.message);
      } else {
        setError("Couldn't update the photo. Tap to retry.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 6 }}>
      <Pressable
        onPress={onPress}
        disabled={busy}
        style={{ paddingVertical: 10, borderRadius: radius.sm, opacity: busy ? 0.6 : 1 }}
      >
        {busy ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <Text style={{ color: colors.accent, fontWeight: "700" }}>
            {error ? "Retry photo" : "Change photo"}
          </Text>
        )}
      </Pressable>
      {error ? (
        <Text style={{ color: colors.danger, fontSize: 13 }}>{error}</Text>
      ) : null}
    </View>
  );
}
```

---

## 🚶 Step-by-Step Execution Guide

1. **Install** `expo-image-picker`, `expo-file-system`, and `expo-crypto` SCOPED to the
   mobile workspace (`pnpm --filter mobile …`, NOT root — same rule applies to any installs
   noted in integration/003). Add the iOS photo-library usage string
   (`NSPhotoLibraryUsageDescription`) to `app.json`.

2. **Create the bucket + RLS** by running `storage_setup.sql` (§2) in Supabase. Confirm
   the `item-images` bucket is **private** with `file_size_limit` + `allowed_mime_types`
   set, and that **four** folder-scoped policies exist — SELECT, INSERT, UPDATE (with both
   USING and WITH CHECK), DELETE. Policy creation is idempotent (`drop policy if exists`),
   so the script is safe to re-run.

3. **Build the upload pipeline** `lib/media/uploadItemImage.ts` (§3). Validate size/MIME
   FIRST, then use the SDK 56 `File.arrayBuffer()` API and upload with `contentType` to a
   NEW UUID-versioned path `<userId>/<itemId>/<version>.<ext>` (no upsert, no delete
   here). Export `deleteItemImageObject` only for rollback of an uncommitted upload.

4. **Add the backend PATCH** `/api/items/:id/image` (§4), validating the OBJECT PATH
   matches the exact `<uid>/<itemId>/<uuid-v4>.<ext>` shape in the user's own folder,
   atomically swaps the path, and cleans up the prior object after commit.

5. **Add the client wrapper** `setItemImage` (§5, sends `imagePath`, parses the response
   with `ItemDtoSchema`) and the `ChangePhotoButton` UI (§6). It uploads → PATCHes; on
   failure it deletes the just-uploaded object, while the backend owns cleanup of the
   replaced object. On success it `upsert`s the updated item so card + detail refresh.

6. Place `ChangePhotoButton` on the item detail screen (`frontend/004`).

---

## 🧪 Verification & Test Protocols

### A. Non-zero upload

After picking and uploading an image, inspect the object in Supabase Dashboard →
Storage → `item-images/<userId>/<itemId>/<version>.jpg`. Confirm its **size is non-zero**
and it previews correctly.

### B. Signed-URL read (private bucket)

```bash
# The bucket is PRIVATE — the public path must be FORBIDDEN, and a signed URL must work.
curl -sI "https://<ref>.supabase.co/storage/v1/object/public/item-images/<uid>/<id>/<v>.jpg" \
  | head -1
# HTTP/2 400 or 404 — no public access

# The ItemDto returned by Hono contains a signed URL that serves the image:
curl -sI "https://<ref>.supabase.co/storage/v1/object/sign/item-images/<uid>/<id>/<v>.jpg?token=…" \
  | grep -i content-type
# content-type: image/jpeg
```

### C. RLS enforcement (negative)

Using a signed-in client for user A, attempt to upload to user B's folder:

```ts
// should FAIL with a row-level security / unauthorized error
await supabase.storage.from("item-images").upload(`<USER_B_ID>/x/1.jpg`, buf, { contentType: "image/jpeg" });
```

Expect a storage policy violation. Confirms the folder-scoped write policy is the real
guard (Hono is not in this path). Likewise `createSignedUrl` for B's path from A's client
must fail (owner-scoped SELECT).

### D. Backend path validation (exact key shape)

```bash
TOKEN="<user A jwt>"
# Reject a foreign/non-conforming path:
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH http://localhost:3000/api/items/<id>/image \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"imagePath":"https://evil.example.com/x.jpg"}'
# 400  (invalid_image_path — not the <uid>/<id>/<version>.<ext> shape)

# Reject a path in the user's folder but for a DIFFERENT item id (prefix-only would pass):
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH http://localhost:3000/api/items/<id>/image \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"imagePath":"<uidA>/<OTHER_ID>/550e8400-e29b-41d4-a716-446655440000.jpg"}'
# 400  (invalid_image_path — must be exactly <uid>/<this item id>/<version>.<ext>)

# Reject a path carrying a query string (the version is in the PATH, never a ?v= query):
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH http://localhost:3000/api/items/<id>/image \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"imagePath":"<uidA>/<id>/550e8400-e29b-41d4-a716-446655440000.jpg?v=123"}'
# 400  (invalid_image_path — no query string allowed)
```

### E. End-to-end refresh

On the detail screen tap "Change photo" → pick an image → spinner → the hero image and
the dashboard card both update to the new photo without a manual refresh (store
`upsert`).

### F. Re-pick — new versioned path, inherent cache-bust

Pick a different image for the same item. The upload lands at a NEW path
(`…/<id>/<newVersion>.<ext>`), so the stored path changes and the signed URL differs —
cache-busting is inherent (no `?v=` query needed, which is good because the backend regex
rejects query strings). After PATCH success the PREVIOUS object is deleted, so listing
`item-images/<uid>/<id>/` shows exactly ONE object (the latest version).

### G. Ordering safety — failed PATCH leaves no orphan, no dangling pointer

Force the PATCH to fail (e.g. stop the backend, or temporarily make the path regex
reject). Re-pick a photo:
- The new object uploads, the PATCH fails, and `ChangePhotoButton`'s catch deletes the
  just-uploaded object → listing `item-images/<uid>/<id>/` still shows only the OLD
  object (no orphan).
- The item's stored `imageUrl` still points at the still-present OLD object (the DB never
  points at a deleted object). A user-facing "Retry photo" appears. Restore the backend,
  retry → the new version commits and the old object is deleted.

### H. Bucket constraints reject bad uploads

Attempt to upload a non-image MIME (e.g. `application/pdf`) or a file over 5 MB → the
CLIENT validation (`validateAsset`) rejects it first with a user-facing message, and even
if bypassed the storage layer rejects it (`allowed_mime_types` / `file_size_limit`).
Confirms validation runs both client-side AND server-side (defense in depth).

### I. Permission denied — user-facing state

Deny photo-library permission, then tap "Change photo" → `pickImage` throws
`MediaPermissionError`, the button shows a "Photo access denied… retry" message instead
of failing silently, and tapping again re-runs the flow.

✅ **Phase complete when:** uploads produce non-zero, correctly-typed objects in a PRIVATE
bucket read via signed URLs, RLS (incl. the SELECT policy) blocks cross-user access, the
bucket + client both reject oversized/non-image files, each re-pick writes a NEW versioned
path and the ordering (upload → PATCH → delete-old) leaves no orphan and never points the
DB at a deleted object on failure, the backend rejects foreign/mismatched paths and any
query string (exact `<uid>/<id>/<version>.<ext>` shape), denied permission/upload errors
surface a retry, and picking a photo updates the card + detail live.

---

### ✅ Phase gate (Definition of Done)

Run the shared workspace gate from [`000-conventions-and-tooling.md`](../000-conventions-and-tooling.md) before starting the next phase:

```bash
pnpm gate          # tsc --noEmit (all packages) + biome lint + biome format check
pnpm -r test       # any unit tests added in this phase
```

Both must exit `0`. The same gate runs in CI on every push, and a pre-commit hook runs it on staged files — this is how type-safety and style stay consistent across phases.
