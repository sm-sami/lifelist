import { apiFetch } from "@/lib/api/client";
import { useEffect, useState } from "react";

interface MeData {
  displayName: string | null;
  avatarUrl: string | null;
}

export function useMeData() {
  const [data, setData] = useState<MeData | null>(null);
  useEffect(() => {
    apiFetch("/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (body)
          setData({ displayName: body.displayName ?? null, avatarUrl: body.avatarUrl ?? null });
      })
      .catch(() => {});
  }, []);
  return data;
}
