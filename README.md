# SetLab

A desktop app that helps you build DJ sets. Paste a Spotify or SoundCloud link (or type artist and title) and SetLab suggests fitting next tracks based on key (Camelot), tempo, genre and energy. No AI, no API key needed.

## Features

* Start from a Spotify link, a SoundCloud link or plain text
* Ten ranked suggestions per step, each with a short reason like 8A → 9A or 174 → 172 BPM
* Fresh suggestions on every step, tracks you already saw move to the back
* Filters for harmonic mixing, same key, genre family, tempo direction and tolerance
* Deep search that digs further through related artists when strict key filters leave too few matches
* Mainstream to underground slider
* Reads the genre tag and credited artist from SoundCloud pages, works with label uploads and bootlegs
* 30 second previews for suggestions and set tracks, plus quick links to Spotify and SoundCloud
* Enter missing BPM or key by hand
* Copy the finished set to the clipboard

## Download

Grab the installer for your system from the [Releases](../../releases) page:

* Windows: `.msi` or `-setup.exe`
* macOS: `.dmg`
* Linux: `.AppImage` or `.deb`

The app is not code signed, so Windows may show a SmartScreen warning. Click "More info" and then "Run anyway". On macOS, right click the app and choose Open the first time.

## Build from source

```
npm install
npm run tauri dev
```

Requires Node.js, Rust and the Tauri prerequisites for your system.

## How it works

* `src/data` fetches info from Deezer, ReccoBeats, Spotify and SoundCloud
* `src/engine` collects candidates from related artists and recommendations
* `src/core` scores every candidate on key, tempo, genre and energy
* `src/main.ts` is the UI

## Disclaimer

For private use only. SetLab is not affiliated with Deezer, Spotify, SoundCloud or ReccoBeats and does not download any audio.
