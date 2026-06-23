/**
 * Mechanical cleanup only. New items use their LLM-produced stored query; this
 * fallback keeps legacy items searchable without encoding domain aliases.
 */
export function normalizeExperienceQuery(title: string): string {
  return title.trim().normalize("NFKC").replace(/\s+/g, " ");
}
