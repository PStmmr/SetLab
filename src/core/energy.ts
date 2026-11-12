/** Energy matching. Rewards similar energy or the chosen direction up or down. */
import type { Direction } from "./types";

export function energyScore(from: number, to: number, direction: Direction = "any"): number {
  const diff = to - from;
  if (direction === "up") {
    if (diff >= 0 && diff <= 0.15) return 1;
    if (diff > 0.15) return Math.max(0, 1 - (diff - 0.15) / 0.3);
    return Math.max(0, 1 + diff / 0.2);
  }
  if (direction === "down") {
    return energyScore(-from, -to, "up");
  }
  return Math.max(0, 1 - Math.abs(diff) / 0.3);
}
