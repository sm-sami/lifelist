import { apiFetch } from "@/lib/api/client";
import { type Experience, ExperienceSchema } from "@lifelist/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

const ExperiencesResponseSchema = z.object({ experiences: z.array(ExperienceSchema) });

interface State {
  experiences: Experience[];
  loading: boolean;
  error: boolean;
  refetch: () => void;
}

export function useExperiences(query: string, location?: string | null): State {
  const [state, setState] = useState<Omit<State, "refetch">>({
    experiences: [],
    loading: true,
    error: false,
  });
  const fetchRef = useRef<() => void>(() => {});

  const fetch = useCallback(() => {
    if (!query.trim()) {
      setState({ experiences: [], loading: false, error: false });
      return () => {};
    }
    const controller = new AbortController();
    const params = new URLSearchParams({ q: query, limit: "6" });
    if (location?.trim()) params.set("location", location);
    setState((s) => ({ ...s, loading: true, error: false }));
    apiFetch(`/experiences?${params.toString()}`, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Experiences request failed: ${r.status}`);
        return ExperiencesResponseSchema.parse(await r.json());
      })
      .then((body) => {
        if (!controller.signal.aborted) {
          setState({ experiences: body.experiences, loading: false, error: false });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({ experiences: [], loading: false, error: true });
        }
      });
    return () => controller.abort();
  }, [query, location]);

  useEffect(() => {
    fetchRef.current = fetch;
  }, [fetch]);

  useEffect(() => {
    return fetch();
  }, [fetch]);

  const refetch = useCallback(() => {
    fetchRef.current();
  }, []);

  return { ...state, refetch };
}
