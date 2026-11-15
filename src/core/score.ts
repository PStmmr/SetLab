/** The heart of the ranking. Combines key, tempo, genre, energy and artist affinity into one score, applies the filters and sorts the suggestions. */
import { formatCamelot, harmonicScore, toCamelot } from "./camelot";
import { energyScore } from "./energy";
import { families, genreScore } from "./genre";
import { DEFAULT_TEMPO, matchTempo, tempoScore } from "./tempo";
import type { Direction, Track } from "./types";

export interface Weights {
  harmony: number;
  tempo: number;
  genre: number;
  energy: number;
  affinity: number;
}

export interface Filters {
  harmonicOnly: boolean;
  sameKey: boolean;
  maxTempoPct: number;
  sameGenreFamily: boolean;
}

export interface RankOptions {
  weights: Weights;
  filters: Filters;
  direction: Direction;
  underground: number;
  limit: number;
  avoid?: string[];
}

export const DEFAULT_OPTIONS: RankOptions = {
  weights: { harmony: 0.3, tempo: 0.3, genre: 0.2, energy: 0.1, affinity: 0.1 },
  filters: { harmonicOnly: false, sameKey: false, maxTempoPct: 8, sameGenreFamily: false },
  direction: "any",
  underground: 0,
  limit: 10,
};

export interface Parts {
  harmony: number;
  tempo: number;
  genre: number;
  energy: number;
  affinity: number;
}

export interface Suggestion {
  track: Track;
  score: number;
  parts: Parts;
  reasons: string[];
}

const NEUTRAL = 0.5;

function hasKey(t: Track): t is Track & Required<Pick<Track, "key" | "mode">> {
  return typeof t.key === "number" && (t.mode === "major" || t.mode === "minor");
}

function formatPct(p: number): string {
  const rounded = Math.round(p * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded.toString()} %`;
}

export function scorePair(
  from: Track,
  to: Track,
  options: RankOptions = DEFAULT_OPTIONS,
): Suggestion | null {
  const reasons: string[] = [];
  const parts: Parts = { harmony: NEUTRAL, tempo: NEUTRAL, genre: NEUTRAL, energy: NEUTRAL, affinity: to.affinity ?? NEUTRAL };

  if (hasKey(from) && hasKey(to)) {
    const a = toCamelot(from.key, from.mode);
    const b = toCamelot(to.key, to.mode);
    parts.harmony = harmonicScore(a, b);
    reasons.push(`${formatCamelot(a)} → ${formatCamelot(b)}`);
    if (options.filters.harmonicOnly && parts.harmony < 0.85) return null;
    if (options.filters.sameKey && formatCamelot(a) !== formatCamelot(b)) return null;
  } else {
    if (options.filters.sameKey && hasKey(from)) return null;
    reasons.push("Key unknown");
  }

  if (from.bpm && to.bpm) {
    const match = matchTempo(from.bpm, to.bpm);
    if (Math.abs(match.diffPct) > options.filters.maxTempoPct) return null;
    parts.tempo = tempoScore(from.bpm, to.bpm, { ...DEFAULT_TEMPO, direction: options.direction });
    const note = match.factor === 1 ? "" : match.factor === 2 ? " (Double-Time)" : " (Half-Time)";
    reasons.push(`${Math.round(from.bpm)} → ${Math.round(to.bpm)} BPM, ${formatPct(match.diffPct)}${note}`);
  } else {
    reasons.push("BPM unknown");
  }

  if (options.filters.sameGenreFamily) {
    const fa = families(from.genres);
    const fb = families(to.genres);
    if (fa.size > 0 && fb.size > 0 && ![...fa].some((f) => fb.has(f))) return null;
  }
  parts.genre = genreScore(from.genres, to.genres);
  const shared = to.genres.filter((g) => from.genres.some((h) => h.toLowerCase() === g.toLowerCase()));
  if (shared.length > 0) reasons.push(`Style: ${shared.slice(0, 3).join(", ")}`);

  if (from.energy !== undefined && to.energy !== undefined) {
    parts.energy = energyScore(from.energy, to.energy, options.direction);
  }

  const w = options.weights;
  const total = w.harmony + w.tempo + w.genre + w.energy + w.affinity;
  let score =
    (w.harmony * parts.harmony +
      w.tempo * parts.tempo +
      w.genre * parts.genre +
      w.energy * parts.energy +
      w.affinity * parts.affinity) /
    (total || 1);
  if (to.popularity !== undefined) score -= options.underground * 0.15 * to.popularity;

  return { track: to, score: Math.max(0, Math.min(1, score)), parts, reasons };
}

/** v0.2.0 - Identifies a song independent of the data source, so the same song from Deezer and ReccoBeats counts once. */
export function trackKey(t: Track): string {
  const norm = (s: string) => s.toLowerCase().replace(/[([](?:feat|ft)\.?[^)\]]*[)\]]|\b(?:feat|ft)\.?\s.*$/gi, "").replace(/[^\p{L}\p{N}]+/gu, "");
  return `${norm(t.artist)}|${norm(t.title)}`;
}

export function rankCandidates(
  current: Track,
  candidates: Track[],
  set: Track[] = [],
  options: RankOptions = DEFAULT_OPTIONS,
): Suggestion[] {
  const usedIds = new Set([current.id, ...set.map((t) => t.id)]);
  const usedKeys = new Set([current, ...set].map(trackKey));
  const avoid = new Set(options.avoid ?? []);
  const recentArtists = new Set(
    [...set.slice(-2), current].map((t) => t.artist.toLowerCase()),
  );
  const seen = new Set<string>();
  const results: Suggestion[] = [];
  for (const candidate of candidates) {
    const key = trackKey(candidate);
    if (usedIds.has(candidate.id) || usedKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    const suggestion = scorePair(current, candidate, options);
    if (!suggestion) continue;
    if (recentArtists.has(candidate.artist.toLowerCase())) suggestion.score *= 0.7;
    results.push(suggestion);
  }
  results.sort((a, b) => b.score - a.score);
  const fresh = results.filter((s) => !avoid.has(trackKey(s.track)));
  const repeated = results.filter((s) => avoid.has(trackKey(s.track)));
  return [...fresh, ...repeated].slice(0, options.limit);
}
