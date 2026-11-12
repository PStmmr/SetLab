/** Deezer client. Search, track details, genres, related artists and their top tracks. */
import type { Track } from "../core/types";
import type { HttpGet } from "./http";

export interface DeezerArtistRef {
  id: number;
  name: string;
}

export interface DeezerTrack {
  id: number;
  title: string;
  isrc?: string;
  rank?: number;
  bpm?: number;
  preview?: string;
  artist: DeezerArtistRef;
  album?: { id: number; title?: string; cover_medium?: string };
}

export interface DeezerArtist extends DeezerArtistRef {
  nb_fan?: number;
}

interface DeezerList<T> {
  data?: T[];
}

interface DeezerAlbum {
  genres?: { data?: { name: string }[] };
}

function isError(value: unknown): boolean {
  return typeof value === "object" && value !== null && "error" in value;
}

export function rankToPopularity(rank: number | undefined): number | undefined {
  if (rank === undefined) return undefined;
  return Math.min(1, Math.max(0, rank / 1_000_000));
}

export function deezerToTrack(t: DeezerTrack): Track {
  return {
    id: `dz:${t.id}`,
    title: t.title,
    artist: t.artist.name,
    genres: [],
    deezerId: t.id,
    deezerArtistId: t.artist.id,
    isrc: t.isrc,
    bpm: t.bpm && t.bpm > 0 ? t.bpm : undefined,
    preview: t.preview || undefined,
    cover: t.album?.cover_medium,
    popularity: rankToPopularity(t.rank),
  };
}

export class DeezerClient {
  constructor(
    private readonly get: HttpGet,
    private readonly base = "https://api.deezer.com",
  ) {}

  private async list<T>(path: string): Promise<T[]> {
    const result = (await this.get(`${this.base}${path}`)) as DeezerList<T>;
    if (isError(result)) return [];
    return result.data ?? [];
  }

  private async single<T>(path: string): Promise<T | null> {
    const result = await this.get(`${this.base}${path}`);
    if (isError(result) || result === null) return null;
    return result as T;
  }

  search(query: string, limit = 10): Promise<DeezerTrack[]> {
    return this.list<DeezerTrack>(`/search?q=${encodeURIComponent(query)}&limit=${limit}`);
  }

  track(id: number): Promise<DeezerTrack | null> {
    return this.single<DeezerTrack>(`/track/${id}`);
  }

  trackByIsrc(isrc: string): Promise<DeezerTrack | null> {
    return this.single<DeezerTrack>(`/track/isrc:${encodeURIComponent(isrc)}`);
  }

  async albumGenres(albumId: number): Promise<string[]> {
    const album = await this.single<DeezerAlbum>(`/album/${albumId}`);
    return album?.genres?.data?.map((g) => g.name) ?? [];
  }

  searchArtist(name: string, limit = 5): Promise<DeezerArtist[]> {
    return this.list<DeezerArtist>(`/search/artist?q=${encodeURIComponent(name)}&limit=${limit}`);
  }

  related(artistId: number, limit = 10): Promise<DeezerArtist[]> {
    return this.list<DeezerArtist>(`/artist/${artistId}/related?limit=${limit}`);
  }

  top(artistId: number, limit = 5): Promise<DeezerTrack[]> {
    return this.list<DeezerTrack>(`/artist/${artistId}/top?limit=${limit}`);
  }
}
