/** Input parsing. Detects Spotify links, SoundCloud links or free text and strips title noise like Free Download. */
export type ParsedInput =
  | { kind: "spotify"; id: string; url: string }
  | { kind: "soundcloud"; url: string }
  | { kind: "text"; query: string };

const SPOTIFY_URL = /open\.spotify\.com\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?track\/([A-Za-z0-9]{22})/i;
const SPOTIFY_URI = /^spotify:track:([A-Za-z0-9]{22})$/;
const SOUNDCLOUD_URL = /^https?:\/\/(?:www\.|m\.)?soundcloud\.com\/[^/\s]+\/[^/?#\s]+|^https?:\/\/on\.soundcloud\.com\/\S+/i;

export function parseInput(raw: string): ParsedInput {
  const input = raw.trim();
  const spotify = input.match(SPOTIFY_URL) ?? input.match(SPOTIFY_URI);
  if (spotify) return { kind: "spotify", id: spotify[1], url: `https://open.spotify.com/track/${spotify[1]}` };
  const soundcloud = input.match(SOUNDCLOUD_URL);
  if (soundcloud) return { kind: "soundcloud", url: soundcloud[0].split("?")[0] };
  return { kind: "text", query: input };
}

export function searchText(...parts: (string | undefined)[]): string {
  return parts
    .filter((p): p is string => Boolean(p))
    .join(" ")
    .replace(/\((?:feat|ft)\.?[^)]*\)/gi, " ")
    .replace(/\b(?:feat|ft)\.?\s[^()[\]]*/gi, " ")
    .replace(/[()[\]]/g, " ")
    .replace(/\s+-\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function spotifyUrl(spotifyId: string | undefined, artist: string, title: string): string {
  if (spotifyId) return `https://open.spotify.com/track/${spotifyId}`;
  return `https://open.spotify.com/search/${encodeURIComponent(searchText(artist, title))}`;
}

export function soundcloudUrl(artist: string, title: string): string {
  return `https://soundcloud.com/search/sounds?q=${encodeURIComponent(searchText(artist, title))}`;
}

const NOISE = /\b(free\s*download|free\s*dl|out\s*now|premiere|exclusive|clip)\b/gi;
const VERSION = /[([](?:[^)\]]*?\b(?:bootleg|remix|edit|flip|vip|rework|refix|mashup|cover|dub)\b[^)\]]*)[)\]]/gi;

export function stripNoise(title: string): string {
  return title
    .replace(/[([][^)\]]*\b(?:free\s*download|free\s*dl|out\s*now|premiere)\b[^)\]]*[)\]]/gi, " ")
    .replace(NOISE, " ")
    .replace(/\s*[|/]\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** v0.2.0 - Splits label uploads like "BCee - Back To The Street" into artist and title. */
export function splitArtistTitle(title: string): { artist: string; title: string } | null {
  const match = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  return match ? { artist: match[1].trim(), title: match[2].trim() } : null;
}

export function originalTitle(title: string): string {
  return stripNoise(title)
    .replace(VERSION, " ")
    .replace(/\s+-\s+.*\b(?:bootleg|remix|edit|flip|vip|rework|refix)\b.*$/i, " ")
    .replace(/\s+/g, " ")
    .trim();
}
