import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { useItemsStore } from "@/store/items";
import { ItemDtoSchema } from "@lifelist/shared";
import { useEffect } from "react";
import { z } from "zod";

const ItemIdSchema = z.string().uuid();

export function useItemsRealtime() {
  const { session } = useAuth();
  const upsert = useItemsStore((state) => state.upsert);
  const remove = useItemsStore((state) => state.remove);
  const fetchItemById = useItemsStore((state) => state.fetchItemById);

  useEffect(() => {
    const userId = session?.user.id;
    const accessToken = session?.access_token;
    if (!userId || !accessToken) return;

    let cancelled = false;
    const created: ReturnType<typeof supabase.channel>[] = [];

    const track = (channel: ReturnType<typeof supabase.channel>) => {
      if (cancelled) {
        void supabase.removeChannel(channel);
      } else {
        created.push(channel);
      }
      return channel;
    };

    void (async () => {
      await supabase.realtime.setAuth(accessToken);
      if (cancelled) return;

      const broadcast = track(
        supabase
          .channel(`user:${userId}`, {
            config: { private: true, broadcast: { self: false } },
          })
          .on("broadcast", { event: "item.enriched" }, ({ payload }) => {
            const parsed = ItemDtoSchema.safeParse((payload as { item?: unknown })?.item);
            if (parsed.success && useItemsStore.getState().ownerUserId === userId) {
              upsert(parsed.data);
            }
          }),
      );

      broadcast.subscribe((status, error) => {
        if (status === "CHANNEL_ERROR") console.error("[realtime] broadcast", error);
      });

      const dbChanges = track(
        supabase.channel(`items-changes:${userId}`).on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "items",
            filter: `user_id=eq.${userId}`,
          },
          (change) => {
            const row = (change.eventType === "DELETE" ? change.old : change.new) as Record<
              string,
              unknown
            >;
            const id = ItemIdSchema.safeParse(row.id);
            if (!id.success) return;

            if (change.eventType === "DELETE") {
              remove(id.data);
              return;
            }

            void fetchItemById(id.data).then((result) => {
              if (result.kind === "not_found") remove(id.data);
              if (result.kind === "error") {
                console.error("[realtime] item refresh failed", result.error);
              }
            });
          },
        ),
      );

      dbChanges.subscribe((status, error) => {
        if (status === "CHANNEL_ERROR") console.error("[realtime] postgres changes", error);
      });
    })().catch((error) => console.error("[realtime] setup failed", error));

    return () => {
      cancelled = true;
      for (const channel of created) {
        void supabase.removeChannel(channel);
      }
    };
  }, [session?.user.id, session?.access_token, upsert, remove, fetchItemById]);
}
