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
