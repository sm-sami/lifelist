import { makeAdminClient } from "../lib/supabase-admin";

const admin = makeAdminClient();

export async function broadcastItemEnriched(userId: string, payload: unknown): Promise<void> {
  const channel = admin.channel(`user:${userId}`, {
    config: { private: true, broadcast: { ack: true } },
  });
  await channel.send({ type: "broadcast", event: "item.enriched", payload });
  await admin.removeChannel(channel);
}
