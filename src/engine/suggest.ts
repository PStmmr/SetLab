/** The pipeline. Resolves the start track, collects candidates from related artists and recommendations, fills in missing values and ranks everything. */
import { DEFAULT_OPTIONS, rankCandidates, scorePair, type RankOptions, type Suggestion } from "../core/score";
import type { Track } from "../core/types";
import { DeezerClient, deezerToTrack } from "../data/deezer";
import type { HttpGet } from "../data/http";
import { originalTitle, parseInput, searchText, splitArtistTitle, stripNoise } from "../data/links";
import { soundcloudOembed, soundcloudPage, spotifyOembed } from "../data/oembed";
import { applyFeatures, ReccoBeatsClient, reccoToTrack, type RbTrack } from "../data/reccobeats";

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
  /** How many of the closest artists are also looked up on ReccoBeats, where BPM and key are known. */
  reccoArtists: number;
  tracksPerReccoArtist: number;
  tracksPerArtist: number;
  recommendations: number;
}

export const DEFAULT_CANDIDATES: CandidateOptions = {
  relatedArtists: 10,
  reccoArtists: 8,
  tracksPerReccoArtist: 10,
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
    const [info, page] = await Promise.all([
      safe(soundcloudOembed(get, input.url), null),
      safe(soundcloudPage(get, input.url), {}),
    ]);
    if (!info) return [];
    const cleaned = stripNoise(info.title);
    const split = splitArtistTitle(cleaned);
    const artist = page.artist ?? split?.artist ?? info.artist;
    const title = split?.title ?? cleaned;
    const names = [artist, split?.artist, info.artist];
    const tagGenres = page.genre ? [page.genre] : [];
    const hits = await safe(deezer.search(searchText(artist, title)), []);
    const exact = hits.filter((h) => names.some((n) => sameName(h.artist.name, n)));
    if (exact.length > 0) {
      return exact.map((h) => {
        const track = deezerToTrack(h);
        return { ...track, genres: [...new Set([...tagGenres, ...track.genres])], sourceUrl: input.url };
      });
    }
    const only = await soundcloudOnly(engine, input.url, title, names, info.cover);
    return [{ ...only, genres: [...new Set([...tagGenres, ...only.genres])] }];
  }

  if (!input.query) return [];
  const hits = await safe(deezer.search(input.query), []);
  return hits.map(deezerToTrack);
}

function sameName(a: string | undefined, b: string | undefined): boolean {
  const norm = (s: string | undefined) => (s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const x = norm(a);
  const y = norm(b);
  if (x === "" || y === "") return false;
  if (x === y) return true;
  const parts = (s: string | undefined) => (s ?? "").split(/\s*(?:&|,|\bx\b|\band\b|\bfeat\.?|\bft\.?)\s*/i).map(norm);
  return parts(b).includes(x) || parts(a).includes(y);
}

/** v01.1 - A SoundCloud only track that has no seed artists yet, for example one saved by an older version. */
function needsSeeds(t: Track): boolean {
  return t.id.startsWith("sc:") && t.deezerArtistId === undefined && (t.seedArtistIds ?? []).length === 0;
}

async function soundcloudOnly(
  engine: Engine,
  url: string,
  title: string,
  artists: (string | undefined)[],
  cover: string | undefined,
): Promise<Track> {
  const { deezer } = engine;
  const seeds: number[] = [];
  let genres: string[] = [];
  const names = [...new Set(artists.filter((a): a is string => Boolean(a)))];
  for (const name of names) {
    const found = await safe(deezer.searchArtist(name), []);
    const match = found.find((a) => sameName(a.name, name));
    if (match) seeds.push(match.id);
  }
  const original = originalTitle(title);
  if (original) {
    const withArtist = await safe(deezer.search(searchText(names[0], original), 5), []);
    const [hit] = withArtist.length > 0 ? withArtist : await safe(deezer.search(searchText(original), 5), []);
    if (hit) {
      seeds.push(hit.artist.id);
      if (hit.album?.id !== undefined) genres = await safe(deezer.albumGenres(hit.album.id), []);
    }
  }
  return {
    id: `sc:${url}`,
    title,
    artist: names[0] ?? "Unknown",
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
  if (needsSeeds(start)) {
    const seeded = await soundcloudOnly(engine, start.sourceUrl ?? start.id.slice(3), start.title, [start.artist], start.cover);
    start = { ...start, seedArtistIds: seeded.seedArtistIds, genres: start.genres.length > 0 ? start.genres : seeded.genres };
  }
  let track = start;
  if (!track.reccoId && !track.spotifyId) {
    // Tracks found via Deezer have no ReccoBeats id yet. Look them up so key and energy become known.
    track = await findInRecco(engine, track);
  }
  [track] = await addFeatures(engine, [track]);
  [track] = await addDeezerDetails(engine, [track], true);
  return withManual(track);
}

/** Finds a track on ReccoBeats by title search, matched by ISRC or by artist and title. */
async function findInRecco(engine: Engine, track: Track): Promise<Track> {
  const { recco, deezer } = engine;
  let isrc = track.isrc;
  if (!isrc && track.deezerId !== undefined) isrc = (await safe(deezer.track(track.deezerId), null))?.isrc;
  const norm = (s: string) => searchText(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const pick = (tracks: RbTrack[]) =>
    tracks.find((t) => isrc && t.isrc?.toUpperCase() === isrc.toUpperCase()) ??
    tracks.find((t) => norm(t.trackTitle) === norm(track.title) && t.artists.some((a) => sameName(a.name, track.artist) || sameName(track.artist, a.name)));
  // Title search first. Common titles like "Deeper" have hundreds of hits, so fall back to the artist's own track list.
  let hit = pick(await safe(recco.searchTrack(searchText(track.title)), []));
  if (!hit) {
    const name = track.artist.split(/\s*(?:,|&|\bfeat\.?|\bft\.?)\s*/i)[0];
    const artist = (await safe(recco.searchArtist(name), [])).find((a) => sameName(a.name, name));
    for (let page = 0; artist && !hit && page < 2; page++) {
      const tracks = await safe(recco.artistTracks(artist.id, page), []);
      hit = pick(tracks);
      if (tracks.length < 50) break;
    }
  }
  if (!hit) return { ...track, isrc };
  const r = reccoToTrack(hit);
  return { ...track, reccoId: r.reccoId, spotifyId: track.spotifyId ?? r.spotifyId, isrc: isrc ?? r.isrc };
}

/** Looks up keys for the best suggestions that still have none, so the top of the list is as complete as possible. */
async function fillMissingKeys(engine: Engine, tracks: Track[]): Promise<Track[]> {
  const missing = tracks.filter((t) => typeof t.key !== "number" && !t.reccoId && !t.spotifyId);
  if (missing.length === 0) return tracks;
  const found = await Promise.all(missing.map((t) => findInRecco(engine, t)));
  const withFeatures = await addFeatures(engine, found.filter((t) => t.reccoId || t.spotifyId));
  const byId = new Map(withFeatures.map((t) => [t.id, t]));
  return tracks.map((t) => byId.get(t.id) ?? t);
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
  const relatedNames: string[] = [];
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
    relatedNames.push(...related.map((a) => a.name));
    progress("Loading tracks of similar artists");
    const tops = await Promise.all(related.map((a) => safe(deezer.top(a.id, options.tracksPerArtist), [])));
    tops.forEach((tracks, i) => {
      const affinity = 1 - (0.5 * i) / Math.max(1, related.length);
      tracks.forEach((t) => add({ ...deezerToTrack(t), affinity }));
    });
  }

  const reccoSeeds: string[] = [];
  if (options.reccoArtists > 0) {
    progress("Looking up artists with known keys");
    const names = [start.artist, ...relatedNames].slice(0, options.reccoArtists);
    const lists = await Promise.all(
      names.map(async (name) => {
        const found = await safe(recco.searchArtist(name), []);
        const match = found.find((a) => sameName(a.name, name));
        return match ? safe(recco.artistTracks(match.id), []) : [];
      }),
    );
    lists.forEach((tracks, i) => {
      const affinity = i === 0 ? 0.8 : 1 - (0.5 * i) / names.length;
      const sorted = [...tracks].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
      sorted.slice(0, options.tracksPerReccoArtist).forEach((t) => add({ ...reccoToTrack(t), affinity }));
      if (sorted[0]) reccoSeeds.push(reccoToTrack(sorted[0]).spotifyId ?? sorted[0].id);
    });
  }

  const seeds = [start.spotifyId ?? start.reccoId, ...reccoSeeds].filter((s): s is string => Boolean(s)).slice(0, 5);
  if (seeds.length > 0 && options.recommendations > 0) {
    progress("Loading recommendations");
    const recs = await safe(recco.recommend(seeds, options.recommendations), []);
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

/**
 * v0.2.0
 * Second round for strict key filters. Walks one step further through related artists,
 * pulls their tracks from ReccoBeats (where keys are known) and keeps only the ones that pass the filters.
 * Deezer details are only fetched for those few survivors, which keeps this fast.
 */
async function deepCandidates(
  engine: Engine,
  start: Track,
  known: Track[],
  options: RankOptions,
  progress: Progress,
): Promise<Track[]> {
  const { deezer, recco } = engine;
  progress("Searching deeper for matching keys");
  const seeds = [start.deezerArtistId, ...(start.seedArtistIds ?? [])].filter((id): id is number => id !== undefined);
  const firstRing = (await Promise.all(seeds.map((id) => safe(deezer.related(id, 20), [])))).flat();
  const secondRing = (await Promise.all(firstRing.slice(0, 6).map((a) => safe(deezer.related(a.id, 10), [])))).flat();
  const seenArtists = new Set([start.artist, ...known.map((t) => t.artist)].map((n) => n.toLowerCase()));
  const names = [...new Set([...firstRing, ...secondRing].map((a) => a.name))]
    .filter((n) => !seenArtists.has(n.toLowerCase()))
    .slice(0, 16);

  const lists = await Promise.all(
    names.map(async (name) => {
      const found = await safe(recco.searchArtist(name), []);
      const match = found.find((a) => sameName(a.name, name));
      return match ? safe(recco.artistTracks(match.id), []) : [];
    }),
  );
  const knownKeys = new Set(known.map(identity));
  const fresh = lists
    .flatMap((tracks, i) => tracks.map((t) => ({ ...reccoToTrack(t), affinity: 0.7 - (0.3 * i) / Math.max(1, names.length) })))
    .filter((t) => !knownKeys.has(identity(t)));

  progress("Looking up keys of more tracks");
  const withFeatures = await addFeatures(engine, fresh);
  const passing = withFeatures.filter((t) => scorePair(start, t, options) !== null).slice(0, 30);
  progress("Adding genres");
  return addDeezerDetails(engine, passing, true);
}

export interface SuggestResult {
  start: Track;
  suggestions: Suggestion[];
  candidates: number;
  /** fmi - Candidates whose key is known. */
  withKey: number;
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
  let enriched = await enrichCandidates(engine, raw, progress);
  progress("Ranking");
  let suggestions = rankCandidates(prepared, enriched, set, options);
  const strictKey = options.filters.sameKey || options.filters.harmonicOnly;
  if (suggestions.length < options.limit && strictKey && typeof prepared.key === "number") {
    const deeper = await deepCandidates(engine, prepared, enriched, options, progress);
    enriched = [...enriched, ...deeper];
    suggestions = rankCandidates(prepared, enriched, set, options);
  }
  if (suggestions.some((s) => typeof s.track.key !== "number")) {
    progress("Looking up missing keys");
    const top = rankCandidates(prepared, enriched, set, { ...options, limit: options.limit * 2 }).map((s) => s.track);
    const filled = new Map((await fillMissingKeys(engine, top)).map((t) => [t.id, t]));
    enriched = enriched.map((t) => filled.get(t.id) ?? t);
    suggestions = rankCandidates(prepared, enriched, set, options);
  }
  const withKey = enriched.filter((t) => typeof t.key === "number" && Boolean(t.mode)).length;
  return { start: prepared, suggestions, candidates: enriched.length, withKey };
}
