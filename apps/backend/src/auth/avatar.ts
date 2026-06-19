import type { SupabaseJwtPayload } from "./verify-token";

const DICEBEAR_STYLE = "thumbs";

export function resolveAvatarUrl(payload: SupabaseJwtPayload): string {
  const fromOAuth = payload.user_metadata?.avatar_url ?? payload.user_metadata?.picture;
  if (fromOAuth) return fromOAuth;
  const seed = encodeURIComponent(payload.sub);
  return `https://api.dicebear.com/9.x/${DICEBEAR_STYLE}/png?seed=${seed}&backgroundType=gradientLinear`;
}

export function resolveDisplayName(payload: SupabaseJwtPayload): string | null {
  return (
    payload.user_metadata?.full_name ??
    payload.user_metadata?.name ??
    payload.email?.split("@")[0] ??
    null
  );
}
