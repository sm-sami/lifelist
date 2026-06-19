import { supabase } from "@/lib/supabase";
import { randomUUID } from "expo-crypto";
import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";

const BUCKET = "item-images";
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;

type AllowedMime = (typeof ALLOWED_MIME)[number];

export class MediaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaValidationError";
  }
}

export class MediaPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaPermissionError";
  }
}

export interface UploadResult {
  path: string;
}

export async function pickImage(): Promise<ImagePicker.ImagePickerAsset | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new MediaPermissionError("Media library permission denied");
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    aspect: [3, 4],
    quality: 0.85,
  });

  if (result.canceled || !result.assets[0]) return null;
  return result.assets[0];
}

function extFromMime(mime: AllowedMime): "jpg" | "png" | "webp" {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

async function validateAsset(asset: ImagePicker.ImagePickerAsset): Promise<AllowedMime> {
  const contentType = (asset.mimeType ?? "image/jpeg").toLowerCase();

  if (!ALLOWED_MIME.includes(contentType as AllowedMime)) {
    throw new MediaValidationError("Unsupported image type (use JPEG, PNG, or WebP).");
  }

  const file = new File(asset.uri);
  const size = asset.fileSize ?? file.size;

  if (!Number.isFinite(size) || size <= 0) {
    throw new MediaValidationError("Could not read the selected image.");
  }
  if (size > MAX_BYTES) {
    throw new MediaValidationError("Image is too large (max 5 MB).");
  }

  return contentType as AllowedMime;
}

export async function uploadItemImage(
  userId: string,
  itemId: string,
  asset: ImagePicker.ImagePickerAsset,
): Promise<UploadResult> {
  const contentType = await validateAsset(asset);
  const version = randomUUID();
  const path = `${userId}/${itemId}/${version}.${extFromMime(contentType)}`;
  const arrayBuffer = await new File(asset.uri).arrayBuffer();

  const { error } = await supabase.storage.from(BUCKET).upload(path, arrayBuffer, {
    contentType,
    upsert: false,
  });

  if (error) throw error;
  return { path };
}

export async function deleteItemImageObject(path: string): Promise<void> {
  await supabase.storage.from(BUCKET).remove([path]);
}
