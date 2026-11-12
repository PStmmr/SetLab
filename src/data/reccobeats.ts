/** ReccoBeats client. Provides BPM, key and energy plus recommendations for known tracks. */
import type { Track } from "../core/types";
import type { HttpGet } from "./http";

export interface RbArtist {
  id: string;
  name: string;
  href?: string;
}

export interface RbTrack {
  id: string;
  trackTitle: string;
  artists: RbArtist[];
  isrc?: string;
  href?: string;
  popularity?: number;
}

export interface RbFeatures {
  id: string;
  href?: string;
  isrc?: string;
  tempo?: number;
  key?: number;
  mode?: number;
  energy?: number;
}

interface RbPage<T> {
  content?: T[];
}

const BATCH = 40;

export function spotifyIdFromHref(href: string | undefined): string | undefined {
  return href?.match(/\/track\/([A-Za-z0-9]{22})/)?.[1];
}

export function reccoToTrack(t: RbTrack): Track {
  return {
    id: `rb:${t.id}`,
    title: t.trackTitle,
    artist: t.artists.map((a) => a.name).join(", "),
    genres: [],
    reccoId: t.id,
    spotifyId: spotifyIdFromHref(t.href),
    isrc: t.isrc,
    popularity: t.popularity !== undefined ? t.popularity / 100 : undefined,
  };
}

export function applyFeatures(track: Track, f: RbFeatures): Track {
  return {
    ...track,
    reccoId: track.reccoId ?? f.id,
    isrc: track.isrc ?? f.isrc,
    bpm: f.tempo && f.tempo > 0 ? f.tempo : track.bpm,
    key: f.key !== undefined && f.key >= 0 && f.key <= 11 ? f.key : track.key,
    mode: f.key !== undefined && f.key >= 0 && f.mode !== undefined ? (f.mode === 1 ? "major" : "minor") : track.mode,
    energy: f.energy ?? track.energy,
  };
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

export class ReccoBeatsClient {
  constructor(
    private readonly get: HttpGet,
    private readonly base = "https://api.reccobeats.com",
  ) {}

  private async batched<T>(path: string, ids: string[]): Promise<T[]> {
    const unique = [...new Set(ids)];
    const pages = await Promise.all(
      chunks(unique, BATCH).map((group) => this.get(`${this.base}${path}?ids=${group.join(",")}`) as Promise<RbPage<T>>),
    );
    return pages.flatMap((p) => p.content ?? []);
  }

  tracks(spotifyIds: string[]): Promise<RbTrack[]> {
    return this.batched<RbTrack>("/v1/track", spotifyIds);
  }

  features(ids: string[]): Promise<RbFeatures[]> {
    return this.batched<RbFeatures>("/v1/audio-features", ids);
  }

  async recommend(seeds: string[], size = 20): Promise<RbTrack[]> {
    if (seeds.length === 0) return [];
    const page = (await this.get(
      `${this.base}/v1/track/recommendation?seeds=${seeds.slice(0, 5).join(",")}&size=${size}`,
    )) as RbPage<RbTrack>;
    return page.content ?? [];
  }
}
