function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function hslToHex(h: number, s: number, l: number): string {
  // s and l are integer percentages [0–100]; normalize to [0–1] before computing.
  const sf = s / 100;
  const lf = l / 100;
  const a = sf * Math.min(lf, 1 - lf);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = lf - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.max(0, Math.min(255, Math.round(255 * color)))
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

export interface GradientPair {
  gradientStart: string;
  gradientEnd: string;
}

export function generateGradient(seed: string): GradientPair {
  const hash = hashSeed(seed.toLowerCase().trim());
  const baseHue = 255 + (hash % 36);
  const saturation = 45 + ((hash >> 6) % 21);
  const startL = 24 + ((hash >> 11) % 8);
  const endHue = (baseHue + 8) % 360;
  const endL = 12 + ((hash >> 16) % 6);
  return {
    gradientStart: hslToHex(baseHue, saturation, startL),
    gradientEnd: hslToHex(endHue, Math.max(saturation - 8, 35), endL),
  };
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
