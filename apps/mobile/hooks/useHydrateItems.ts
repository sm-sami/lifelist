import { useAuth } from "@/lib/auth";
import { useItemsStore } from "@/store/items";
import { useLayoutEffect } from "react";

export function useHydrateItems() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const setUser = useItemsStore((state) => state.setUser);
  const hydrate = useItemsStore((state) => state.hydrate);

  useLayoutEffect(() => {
    setUser(userId);
    if (userId) void hydrate(userId);
  }, [userId, setUser, hydrate]);
}
