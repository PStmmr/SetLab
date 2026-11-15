/** Reads title and artist from Spotify and SoundCloud links without any API key. */
import type { HttpGet } from "./http";

export interface OembedInfo {
  title: string;
  artist?: string;
  cover?: string;
}

interface OembedResponse {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
}

export async function spotifyOembed(get: HttpGet, trackUrl: string): Promise<OembedInfo | null> {
  const r = (await get(`https://open.spotify.com/oembed?url=${encodeURIComponent(trackUrl)}`)) as OembedResponse;
  if (!r?.title) return null;
  return { title: r.title, cover: r.thumbnail_url };
}

export async function soundcloudOembed(get: HttpGet, trackUrl: string): Promise<OembedInfo | null> {
  const r = (await get(
    `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(trackUrl)}`,
  )) as OembedResponse;
  if (!r?.title) return null;
  const artist = r.author_name;
  const suffix = artist ? ` by ${artist}` : "";
  const title = suffix && r.title.endsWith(suffix) ? r.title.slice(0, -suffix.length) : r.title;
  return { title, artist, cover: r.thumbnail_url };
}

export interface SoundcloudPageInfo {
  genre?: string;
  artist?: string;
}

/** v0.2.0 - Reads the genre tag and the credited artist from the public SoundCloud track page. */
export async function soundcloudPage(get: HttpGet, trackUrl: string): Promise<SoundcloudPageInfo> {
  const html = await get(trackUrl);
  if (typeof html !== "string") return {};
  const read = (pattern: RegExp): string | undefined => {
    const raw = html.match(pattern)?.[1];
    if (!raw) return undefined;
    try {
      return (JSON.parse(`"${raw}"`) as string).trim() || undefined;
    } catch {
      return undefined;
    }
  };
  return {
    genre: read(/"genre":"((?:[^"\\]|\\.)*)"/),
    artist: read(/"publisher_metadata":\{[^}]*?"artist":"((?:[^"\\]|\\.)*)"/),
  };
}
