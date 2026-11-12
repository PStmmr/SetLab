/** Genre matching. Groups similar genres into families so rap stays with rap. */
const FAMILIES: Record<string, string[]> = {
  "hip hop": ["hip hop", "rap", "trap", "boom bap", "drill", "conscious hip hop", "gangsta rap", "west coast rap", "east coast hip hop", "deutschrap", "cloud rap", "rap hip hop", "rap and hip hop"],
  "drum and bass": ["drum and bass", "drum n bass", "dnb", "jungle", "liquid funk", "neurofunk", "jump up"],
  house: ["house", "deep house", "tech house", "progressive house", "afro house", "bass house", "electro house", "future house"],
  techno: ["techno", "minimal techno", "hard techno", "melodic techno", "industrial techno", "peak time techno"],
  "bass music": ["dubstep", "bass music", "riddim", "uk garage", "speed garage", "breakbeat"],
  trance: ["trance", "psytrance", "progressive trance", "uplifting trance"],
  "r&b": ["r and b", "rnb", "soul", "neo soul", "contemporary r and b", "soul and funk"],
  pop: ["pop", "dance pop", "electropop", "synthpop", "k pop"],
  rock: ["rock", "alternative rock", "indie rock", "punk", "metal", "hard rock", "alternative"],
  latin: ["latin", "reggaeton", "latin pop", "dembow"],
  afro: ["afrobeats", "afrobeat", "amapiano", "afropop"],
  electronic: ["electronic", "dance", "edm", "electronica", "electro"],
};

const TAG_TO_FAMILY = new Map<string, string>();
for (const [family, tags] of Object.entries(FAMILIES)) {
  for (const tag of tags) TAG_TO_FAMILY.set(tag, family);
}

export function normalizeTag(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[-_/]+/g, " ")
    .replace(/[^\p{L}\p{N} ]+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function familyOf(tag: string): string | undefined {
  return TAG_TO_FAMILY.get(normalizeTag(tag));
}

export function families(tags: string[]): Set<string> {
  const result = new Set<string>();
  for (const tag of tags) {
    const family = familyOf(tag);
    if (family) result.add(family);
  }
  return result;
}

export function genreScore(from: string[], to: string[]): number {
  if (from.length === 0 || to.length === 0) return 0.5;
  const a = new Set(from.map(normalizeTag));
  const b = new Set(to.map(normalizeTag));
  let shared = 0;
  for (const tag of a) if (b.has(tag)) shared++;
  const jaccard = shared / (a.size + b.size - shared);
  const fa = families(from);
  const fb = families(to);
  const specific = [...fa].some((f) => f !== "electronic" && fb.has(f));
  const broad = !specific && [...fa].some((f) => fb.has(f));
  const bonus = specific ? 0.6 : broad ? 0.3 : 0;
  return Math.min(1, jaccard + bonus);
}
