import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.SUPABASE_URL ?? "", process.env.SUPABASE_SECRET_KEY ?? "", {
  auth: { persistSession: false },
});

export async function broadcastItemEnriched(userId: string, payload: unknown): Promise<void> {
  const channel = admin.channel(`user:${userId}`, {
    config: { private: true, broadcast: { ack: true } },
  });
  await channel.send({ type: "broadcast", event: "item.enriched", payload });
  await admin.removeChannel(channel);
}
