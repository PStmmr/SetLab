/** Tempo matching. Checks whether two BPM values can be mixed, including half time and double time. */
import type { Direction } from "./types";

export interface TempoMatch {
  targetBpm: number;
  diffPct: number;
  factor: number;
}

const FACTORS = [1, 0.5, 2];

export function matchTempo(fromBpm: number, toBpm: number): TempoMatch {
  let best: TempoMatch = { targetBpm: toBpm, diffPct: Infinity, factor: 1 };
  for (const factor of FACTORS) {
    const targetBpm = toBpm * factor;
    const diffPct = ((targetBpm - fromBpm) / fromBpm) * 100;
    if (Math.abs(diffPct) < Math.abs(best.diffPct)) {
      best = { targetBpm, diffPct, factor };
    }
  }
  return best;
}

export interface TempoOptions {
  tolerancePct: number;
  perfectPct: number;
  direction: Direction;
}

export const DEFAULT_TEMPO: TempoOptions = {
  tolerancePct: 6,
  perfectPct: 3,
  direction: "any",
};

export function tempoScore(
  fromBpm: number,
  toBpm: number,
  options: TempoOptions = DEFAULT_TEMPO,
): number {
  const { diffPct } = matchTempo(fromBpm, toBpm);
  const abs = Math.abs(diffPct);
  let score: number;
  if (abs <= options.perfectPct) score = 1;
  else if (abs >= options.tolerancePct) score = 0;
  else score = 1 - (abs - options.perfectPct) / (options.tolerancePct - options.perfectPct);
  if (options.direction === "up" && diffPct < -0.5) score *= 0.5;
  if (options.direction === "down" && diffPct > 0.5) score *= 0.5;
  return score;
}
