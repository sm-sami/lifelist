import { apiFetch } from "@/lib/api/client";
import { type Experience, ExperienceSchema } from "@lifelist/shared";
import { useEffect, useState } from "react";
import { z } from "zod";

const ExperiencesResponseSchema = z.object({ experiences: z.array(ExperienceSchema) });

interface State {
  experiences: Experience[];
  loading: boolean;
  error: boolean;
}

export function useExperiences(query: string): State {
  const [state, setState] = useState<State>({ experiences: [], loading: true, error: false });

  useEffect(() => {
    if (!query.trim()) {
      setState({ experiences: [], loading: false, error: false });
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: false }));
    apiFetch(`/experiences?q=${encodeURIComponent(query)}&limit=6`, { signal: controller.signal })
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
  }, [query]);

  return state;
}
