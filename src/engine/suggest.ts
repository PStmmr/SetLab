/** The pipeline. Resolves the start track, collects candidates from related artists and recommendations, fills in missing values and ranks everything. */
import { DEFAULT_OPTIONS, rankCandidates, type RankOptions, type Suggestion } from "../core/score";
import type { Track } from "../core/types";
import { DeezerClient, deezerToTrack } from "../data/deezer";
import type { HttpGet } from "../data/http";
import { originalTitle, parseInput, searchText, stripNoise } from "../data/links";
import { soundcloudOembed, spotifyOembed } from "../data/oembed";
import { applyFeatures, ReccoBeatsClient, reccoToTrack } from "../data/reccobeats";

export interface Engine {
  get: HttpGet;
  deezer: DeezerClient;
  recco: ReccoBeatsClient;
}

export function createEngine(get: HttpGet): Engine {
  return { get, deezer: new DeezerClient(get), recco: new ReccoBeatsClient(get) };
}

export interface CandidateOptions {
  relatedArtists: number;
  tracksPerArtist: number;
  recommendations: number;
}

export const DEFAULT_CANDIDATES: CandidateOptions = {
  relatedArtists: 10,
  tracksPerArtist: 4,
  recommendations: 20,
};

export type Progress = (step: string) => void;

const quiet: Progress = () => {};

async function safe<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

function identity(t: Track): string {
  if (t.isrc) return `isrc:${t.isrc.toUpperCase()}`;
  return `${t.artist.toLowerCase()}|${searchText(t.title).toLowerCase()}`;
}

function merge(a: Track, b: Partial<Track>): Track {
  const result: Track = { ...a };
  for (const [key, value] of Object.entries(b) as [keyof Track, unknown][]) {
    if (value === undefined) continue;
    if (key === "genres") {
      result.genres = [...new Set([...a.genres, ...(value as string[])])];
    } else if (key === "affinity") {
      result.affinity = Math.max(a.affinity ?? 0, value as number);
    } else if (result[key] === undefined) {
      (result as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}

export async function resolveStart(engine: Engine, raw: string): Promise<Track[]> {
  const input = parseInput(raw);
  const { deezer, recco, get } = engine;

  if (input.kind === "spotify") {
    const [known] = await safe(recco.tracks([input.id]), []);
    if (known) {
      let track: Track = { ...reccoToTrack(known), spotifyId: input.id, sourceUrl: input.url };
      if (track.isrc) {
        const dz = await safe(deezer.trackByIsrc(track.isrc), null);
        if (dz) track = merge(track, { ...deezerToTrack(dz), id: track.id, title: track.title, artist: track.artist });
      }
      return [track];
    }
    const info = await safe(spotifyOembed(get, input.url), null);
    if (!info) return [];
    const hits = await safe(deezer.search(searchText(info.title)), []);
    return hits.map((h) => ({ ...deezerToTrack(h), sourceUrl: input.url }));
  }

  if (input.kind === "soundcloud") {
    const info = await safe(soundcloudOembed(get, input.url), null);
    if (!info) return [];
    const title = stripNoise(info.title);
    const hits = await safe(deezer.search(searchText(info.artist, title)), []);
    const exact = hits.filter((h) => sameName(h.artist.name, info.artist));
    if (exact.length > 0) return exact.map((h) => ({ ...deezerToTrack(h), sourceUrl: input.url }));
    return [await soundcloudOnly(engine, input.url, title, info.artist, info.cover)];
  }

  if (!input.query) return [];
  const hits = await safe(deezer.search(input.query), []);
  return hits.map(deezerToTrack);
}

function sameName(a: string | undefined, b: string | undefined): boolean {
  const norm = (s: string | undefined) => (s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  return norm(a) !== "" && norm(a) === norm(b);
}

async function soundcloudOnly(
  engine: Engine,
  url: string,
  title: string,
  artist: string | undefined,
  cover: string | undefined,
): Promise<Track> {
  const { deezer } = engine;
  const seeds: number[] = [];
  let genres: string[] = [];
  if (artist) {
    const artists = await safe(deezer.searchArtist(artist), []);
    const match = artists.find((a) => sameName(a.name, artist));
    if (match) seeds.push(match.id);
  }
  const original = originalTitle(title);
  if (original) {
    const [hit] = await safe(deezer.search(original, 5), []);
    if (hit) {
      seeds.push(hit.artist.id);
      if (hit.album?.id !== undefined) genres = await safe(deezer.albumGenres(hit.album.id), []);
    }
  }
  return {
    id: `sc:${url}`,
    title,
    artist: artist ?? "Unknown",
    genres,
    cover,
    sourceUrl: url,
    seedArtistIds: [...new Set(seeds)],
  };
}

async function addDeezerDetails(engine: Engine, tracks: Track[], withGenres: boolean): Promise<Track[]> {
  return Promise.all(
    tracks.map(async (t) => {
      let result = t;
      if (t.deezerId === undefined && t.isrc) {
        const dz = await safe(engine.deezer.trackByIsrc(t.isrc), null);
        if (dz) result = merge(result, { ...deezerToTrack(dz), id: t.id, title: t.title, artist: t.artist });
      } else if (t.deezerId !== undefined && t.bpm === undefined) {
        const dz = await safe(engine.deezer.track(t.deezerId), null);
        if (dz) result = merge(result, { ...deezerToTrack(dz), id: t.id });
      }
      if (withGenres && result.deezerId !== undefined) {
        const dz = await safe(engine.deezer.track(result.deezerId), null);
        const albumId = dz?.album?.id;
        if (albumId !== undefined) {
          result = merge(result, { genres: await safe(engine.deezer.albumGenres(albumId), []) });
        }
      }
      return result;
    }),
  );
}

async function addFeatures(engine: Engine, tracks: Track[]): Promise<Track[]> {
  const ids = tracks.map((t) => t.reccoId ?? t.spotifyId).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return tracks;
  const features = await safe(engine.recco.features(ids), []);
  const byId = new Map<string, (typeof features)[number]>();
  for (const f of features) {
    byId.set(f.id, f);
    const spotify = f.href?.match(/\/track\/([A-Za-z0-9]{22})/)?.[1];
    if (spotify) byId.set(spotify, f);
  }
  return tracks.map((t) => {
    const f = byId.get(t.reccoId ?? "") ?? byId.get(t.spotifyId ?? "");
    return f ? applyFeatures(t, f) : t;
  });
}

export function withManual(track: Track): Track {
  return track.manual ? { ...track, ...track.manual } : track;
}

export async function prepareStart(engine: Engine, start: Track): Promise<Track> {
  let [track] = await addFeatures(engine, [start]);
  [track] = await addDeezerDetails(engine, [track], true);
  return withManual(track);
}

export async function collectCandidates(
  engine: Engine,
  start: Track,
  options: CandidateOptions = DEFAULT_CANDIDATES,
  progress: Progress = quiet,
): Promise<Track[]> {
  const { deezer, recco } = engine;
  const pool = new Map<string, Track>();
  const add = (t: Track) => {
    const key = identity(t);
    const existing = pool.get(key);
    pool.set(key, existing ? merge(existing, t) : t);
  };

  const artistIds = [
    ...new Set([start.deezerArtistId, ...(start.seedArtistIds ?? [])].filter((id): id is number => id !== undefined)),
  ];
  if (artistIds.length > 0) {
    progress("Finding similar artists");
    const perSeed = Math.max(3, Math.ceil(options.relatedArtists / artistIds.length));
    const [owns, relatedLists] = await Promise.all([
      Promise.all(artistIds.map((id) => safe(deezer.top(id, options.tracksPerArtist), []))),
      Promise.all(artistIds.map((id) => safe(deezer.related(id, perSeed), []))),
    ]);
    owns.flat().forEach((t) => add({ ...deezerToTrack(t), affinity: 0.8 }));
    const related = [...new Map(relatedLists.flat().map((a) => [a.id, a])).values()].filter(
      (a) => !artistIds.includes(a.id),
    );
    progress("Loading tracks of similar artists");
    const tops = await Promise.all(related.map((a) => safe(deezer.top(a.id, options.tracksPerArtist), [])));
    tops.forEach((tracks, i) => {
      const affinity = 1 - (0.5 * i) / Math.max(1, related.length);
      tracks.forEach((t) => add({ ...deezerToTrack(t), affinity }));
    });
  }

  const seed = start.spotifyId ?? start.reccoId;
  if (seed && options.recommendations > 0) {
    progress("Loading recommendations");
    const recs = await safe(recco.recommend([seed], options.recommendations), []);
    recs.forEach((t) => add({ ...reccoToTrack(t), affinity: 0.6 }));
  }

  return [...pool.values()].filter((t) => identity(t) !== identity(start));
}

export async function enrichCandidates(engine: Engine, tracks: Track[], progress: Progress = quiet): Promise<Track[]> {
  progress("Looking up BPM and key");
  const withFeatures = await addFeatures(engine, tracks);
  progress("Adding genres");
  return addDeezerDetails(engine, withFeatures, true);
}

export interface SuggestResult {
  start: Track;
  suggestions: Suggestion[];
  candidates: number;
}

export async function suggestNext(
  engine: Engine,
  start: Track,
  set: Track[] = [],
  options: RankOptions = DEFAULT_OPTIONS,
  candidateOptions: CandidateOptions = DEFAULT_CANDIDATES,
  progress: Progress = quiet,
): Promise<SuggestResult> {
  const prepared = await prepareStart(engine, start);
  const raw = await collectCandidates(engine, prepared, candidateOptions, progress);
  const enriched = await enrichCandidates(engine, raw, progress);
  progress("Ranking");
  const suggestions = rankCandidates(prepared, enriched, set, options);
  return { start: prepared, suggestions, candidates: enriched.length };
}
