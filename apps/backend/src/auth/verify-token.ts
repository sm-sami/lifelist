import { makeAdminClient } from "../lib/supabase-admin";

const SUPABASE_URL = process.env.SUPABASE_URL;
if (!SUPABASE_URL) throw new Error("SUPABASE_URL is not set.");
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
if (!SUPABASE_SECRET_KEY) throw new Error("SUPABASE_SECRET_KEY is not set.");

const supabase = makeAdminClient();

export interface SupabaseJwtPayload {
  sub: string;
  email?: string;
  phone?: string;
  role?: string;
  user_metadata?: {
    avatar_url?: string;
    picture?: string;
    full_name?: string;
    name?: string;
  };
}

export type VerifyResult =
  | { ok: true; payload: SupabaseJwtPayload }
  | { ok: false; reason: "invalid" | "unavailable" };

export async function verifySupabaseToken(token: string): Promise<VerifyResult> {
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      return {
        ok: false,
        reason: error?.status === 0 || (error?.status ?? 0) >= 500 ? "unavailable" : "invalid",
      };
    }

    return {
      ok: true,
      payload: {
        sub: data.user.id,
        email: data.user.email,
        phone: data.user.phone,
        role: data.user.role,
        user_metadata: data.user.user_metadata as SupabaseJwtPayload["user_metadata"],
      },
    };
  } catch (err) {
    console.error("[auth] token verifier unavailable", err);
    return { ok: false, reason: "unavailable" };
  }
}
