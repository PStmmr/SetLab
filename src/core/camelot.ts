/** Camelot wheel. Converts keys to Camelot codes like 8A and rates how well two keys mix. */
import type { Camelot, Mode } from "./types";

const mod12 = (n: number): number => ((n % 12) + 12) % 12;

export function toCamelot(key: number, mode: Mode): Camelot {
  if (!Number.isInteger(key) || key < 0 || key > 11) {
    throw new RangeError(`Invalid pitch class: ${key}`);
  }
  const anchor = mode === "minor" ? 8 : 11;
  return {
    number: mod12((key - anchor) * 7) + 1,
    letter: mode === "minor" ? "A" : "B",
  };
}

export function fromCamelot(c: Camelot): { key: number; mode: Mode } {
  const mode: Mode = c.letter === "A" ? "minor" : "major";
  const anchor = mode === "minor" ? 8 : 11;
  return { key: mod12(anchor + (c.number - 1) * 7), mode };
}

export function parseCamelot(text: string): Camelot | null {
  const match = text.trim().toUpperCase().match(/^(1[0-2]|[1-9])([AB])$/);
  return match ? { number: Number(match[1]), letter: match[2] as "A" | "B" } : null;
}

export function formatCamelot(c: Camelot): string {
  return `${c.number}${c.letter}`;
}

export function camelotStep(from: Camelot, to: Camelot): number {
  const d = mod12(to.number - from.number);
  return d > 6 ? d - 12 : d;
}

export function harmonicScore(from: Camelot, to: Camelot): number {
  const step = camelotStep(from, to);
  const sameLetter = from.letter === to.letter;
  if (step === 0) return sameLetter ? 1 : 0.85;
  if (sameLetter && Math.abs(step) === 1) return 0.9;
  if (sameLetter && step === 2) return 0.6;
  if (sameLetter && step === -2) return 0.5;
  if (!sameLetter && Math.abs(step) === 1) return 0.5;
  return 0.1;
}
