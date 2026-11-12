/** Shared data types. A Track holds everything SetLab knows about a song. */
export type Mode = "major" | "minor";

export type Direction = "any" | "up" | "down";

export interface Track {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  bpm?: number;
  key?: number;
  mode?: Mode;
  energy?: number;
  genres: string[];
  popularity?: number;
  affinity?: number;
  isrc?: string;
  deezerId?: number;
  deezerArtistId?: number;
  seedArtistIds?: number[];
  spotifyId?: string;
  reccoId?: string;
  preview?: string;
  cover?: string;
  sourceUrl?: string;
  /** Values entered by hand. They win over the data sources. */
  manual?: { bpm?: number; key?: number; mode?: Mode };
}

export interface Camelot {
  number: number;
  letter: "A" | "B";
}
