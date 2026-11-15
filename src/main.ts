/** The UI. Connects the input, set list, filters and suggestion cards to the engine. */
import { openUrl } from "@tauri-apps/plugin-opener";
import { fetch } from "@tauri-apps/plugin-http";
import { formatCamelot, fromCamelot, parseCamelot, toCamelot } from "./core/camelot";
import { DEFAULT_OPTIONS, trackKey, type RankOptions, type Suggestion } from "./core/score";
import type { Direction, Track } from "./core/types";
import { createHttpGet } from "./data/http";
import { soundcloudUrl, spotifyUrl } from "./data/links";
import { createEngine, resolveStart, suggestNext, withManual } from "./engine/suggest";

const STORAGE_KEY = "setlab.set";

const engine = createEngine(
  createHttpGet((url) => fetch(url), {
    minIntervalMs: { "api.deezer.com": 120, "api.reccobeats.com": 100 },
  }),
);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const els = {
  form: $<HTMLFormElement>("start-form"),
  input: $<HTMLInputElement>("start-input"),
  setList: $<HTMLOListElement>("set-list"),
  setEmpty: $<HTMLParagraphElement>("set-empty"),
  status: $<HTMLParagraphElement>("status"),
  choices: $<HTMLDivElement>("choices"),
  suggestions: $<HTMLDivElement>("suggestions"),
  harmonic: $<HTMLInputElement>("f-harmonic"),
  sameKey: $<HTMLInputElement>("f-samekey"),
  genre: $<HTMLInputElement>("f-genre"),
  direction: $<HTMLSelectElement>("f-direction"),
  tolerance: $<HTMLSelectElement>("f-tolerance"),
  underground: $<HTMLInputElement>("f-underground"),
  refresh: $<HTMLButtonElement>("refresh"),
  exportSet: $<HTMLButtonElement>("export-set"),
  clearSet: $<HTMLButtonElement>("clear-set"),
  player: $<HTMLAudioElement>("player"),
};

let set: Track[] = loadSet();
/** Increases with every refresh. Older runs that finish late are ignored. */
let run = 0;
/** v0.2.0 - Suggestions from the step before the last added track, so the next step avoids repeating them. */
let avoid: string[] = [];
let shown: string[] = [];

function loadSet(): Track[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const tracks = raw ? (JSON.parse(raw) as Track[]) : [];
    // Older versions could save null as key. Treat that as unknown.
    return tracks.map((t) => (typeof t.key === "number" ? t : { ...t, key: undefined, mode: undefined }));
  } catch {
    return [];
  }
}

function saveSet(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(set));
  } catch {
    return;
  }
}

function keyLabel(t: Track): string {
  return typeof t.key === "number" && t.mode ? formatCamelot(toCamelot(t.key, t.mode)) : "–";
}

function bpmLabel(t: Track): string {
  return t.bpm ? `${Math.round(t.bpm)} BPM` : "– BPM";
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function cover(t: Track): HTMLElement {
  if (t.cover) {
    const img = el("img", "cover");
    img.src = t.cover;
    img.alt = "";
    return img;
  }
  return el("div", "cover cover-empty");
}

function linkButtons(t: Track): HTMLElement {
  const box = el("div", "links");
  if (t.preview) {
    box.append(previewButton(t.preview, "▶ Preview", "❚❚ Stop", "ghost"));
  }
  const spotify = el("button", "ghost", "Spotify");
  spotify.type = "button";
  spotify.addEventListener("click", () => openUrl(spotifyUrl(t.spotifyId, t.artist, t.title)));
  const soundcloud = el("button", "ghost", "SoundCloud");
  soundcloud.type = "button";
  soundcloud.addEventListener("click", () => openUrl(t.sourceUrl?.includes("soundcloud.com") ? t.sourceUrl : soundcloudUrl(t.artist, t.title)));
  box.append(spotify, soundcloud);
  return box;
}

let playingButton: HTMLButtonElement | null = null;

/** v0.2.0 */
function previewButton(url: string, idle: string, active: string, className: string): HTMLButtonElement {
  const button = el("button", className, idle);
  button.type = "button";
  button.dataset.idle = idle;
  button.dataset.active = active;
  button.title = "Preview";
  button.addEventListener("click", () => togglePreview(url, button));
  return button;
}

function resetPlaying(): void {
  if (playingButton) playingButton.textContent = playingButton.dataset.idle ?? "";
  playingButton = null;
}

function togglePreview(url: string, button: HTMLButtonElement): void {
  if (playingButton === button && !els.player.paused) {
    els.player.pause();
    resetPlaying();
    return;
  }
  resetPlaying();
  els.player.src = url;
  void els.player.play();
  button.textContent = button.dataset.active ?? "";
  playingButton = button;
}

els.player.addEventListener("ended", resetPlaying);

type Field = "key" | "bpm";

/** Applies a hand entry. Returns false if the input is not understood. */
function applyManual(index: number, field: Field, text: string): boolean {
  const track = set[index];
  const manual = { ...track.manual };
  const value = text.trim().replace(",", ".");
  if (field === "bpm") {
    if (value === "") delete manual.bpm;
    else {
      const bpm = Number(value);
      if (!Number.isFinite(bpm) || bpm < 40 || bpm > 250) return false;
      manual.bpm = bpm;
    }
  } else if (value === "") {
    delete manual.key;
    delete manual.mode;
  } else {
    const camelot = parseCamelot(value);
    if (!camelot) return false;
    Object.assign(manual, fromCamelot(camelot));
  }
  const hasValues = Object.keys(manual).length > 0;
  set[index] = withManual({ ...track, manual: hasValues ? manual : undefined });
  return true;
}

function editableTag(index: number, field: Field): HTMLElement {
  const track = set[index];
  const label = field === "key" ? keyLabel(track) : bpmLabel(track);
  const missing = field === "key" ? keyLabel(track) === "–" : !track.bpm;
  const tag = el("button", missing ? "tag edit muted" : "tag edit", label);
  tag.type = "button";
  tag.title = field === "key" ? "Enter key (Camelot, e.g. 8A)" : "Enter BPM";
  tag.addEventListener("click", () => {
    const input = el("input", "tag-input");
    input.placeholder = field === "key" ? "Key" : "BPM";
    input.value = missing ? "" : field === "key" ? keyLabel(track) : String(Math.round(track.bpm ?? 0));
    let done = false;
    const finish = (save: boolean, keepOpenIfInvalid = true) => {
      if (done) return;
      if (save && !applyManual(index, field, input.value)) {
        if (keepOpenIfInvalid) {
          input.classList.add("invalid");
          return;
        }
        save = false;
      }
      done = true;
      saveSet();
      renderSet();
      if (save && index === set.length - 1) void refresh();
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") finish(true);
      if (event.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true, false));
    tag.replaceWith(input);
    input.focus();
    input.select();
  });
  return tag;
}

function renderSet(): void {
  els.setList.replaceChildren(
    ...set.map((t, i) => {
      const item = el("li", "set-item");
      const meta = el("div", "meta");
      meta.append(el("div", "title", t.title), el("div", "artist", t.artist));
      const tags = el("div", "tags");
      tags.append(editableTag(i, "key"), editableTag(i, "bpm"));
      const remove = el("button", "icon", "×");
      remove.type = "button";
      remove.title = "Remove";
      remove.addEventListener("click", () => {
        set = set.slice(0, i);
        avoid = [];
        saveSet();
        renderSet();
        if (set.length > 0) void refresh();
        else {
          run++;
          setLoading(false);
          els.suggestions.replaceChildren();
        }
      });
      const play = t.preview ? previewButton(t.preview, "▶", "❚❚", "icon play") : el("span", "icon play");
      item.append(cover(t), meta, tags, play, remove);
      return item;
    }),
  );
  els.setEmpty.hidden = set.length > 0;
}

function options(): RankOptions {
  return {
    ...DEFAULT_OPTIONS,
    filters: {
      harmonicOnly: els.harmonic.checked,
      sameKey: els.sameKey.checked,
      sameGenreFamily: els.genre.checked,
      maxTempoPct: Number(els.tolerance.value),
    },
    direction: els.direction.value as Direction,
    underground: Number(els.underground.value),
    avoid,
  };
}

function renderSuggestions(list: Suggestion[]): void {
  shown = list.map((s) => trackKey(s.track));
  els.suggestions.replaceChildren(
    ...list.map((s) => {
      const card = el("article", "card");
      const head = el("div", "card-head");
      const meta = el("div", "meta");
      meta.append(el("div", "title", s.track.title), el("div", "artist", s.track.artist));
      head.append(cover(s.track), meta, el("div", "score", `${Math.round(s.score * 100)}`));
      const reasons = el("div", "tags");
      s.reasons.forEach((r) => reasons.append(el("span", r.includes("unknown") ? "tag muted" : "tag", r)));
      const actions = el("div", "actions");
      const take = el("button", "", "Add to set");
      take.type = "button";
      take.addEventListener("click", () => {
        set = [...set, s.track];
        avoid = shown;
        saveSet();
        renderSet();
        void refresh();
      });
      actions.append(linkButtons(s.track), take);
      card.append(head, reasons, actions);
      return card;
    }),
  );
}

/** Shows a spinner next to the status line and blocks the Refresh button while a search runs. */
function setLoading(on: boolean): void {
  els.status.classList.toggle("busy", on);
  els.suggestions.classList.toggle("loading", on);
  els.refresh.disabled = on;
  els.refresh.textContent = on ? "Loading …" : "Search";
  if (on) els.refresh.classList.remove("pending");
}

/** A filter changed: stop the running search and wait for the user to press Search. */
function filtersChanged(): void {
  if (set.length === 0) return;
  run++;
  setLoading(false);
  els.refresh.classList.add("pending");
  setStatus("Filters changed. Press Search to update the suggestions.");
}

function setStatus(text: string): void {
  els.status.textContent = text;
}

async function refresh(): Promise<void> {
  const current = set[set.length - 1];
  if (!current) return;
  const id = ++run;
  const index = set.length - 1;
  const stale = () => id !== run;
  setLoading(true);
  try {
    const result = await suggestNext(engine, current, set.slice(0, -1), options(), undefined, (step) => {
      if (!stale()) setStatus(step);
    });
    if (stale()) return;
    set[index] = result.start;
    saveSet();
    renderSet();
    renderSuggestions(result.suggestions);
    setStatus(
      result.suggestions.length > 0
        ? `${result.suggestions.length} suggestions from ${result.candidates} candidates`
        : result.candidates === 0
          ? "The data sources know no similar artists for this track. Try another start track or type artist and title instead."
          : `No matching tracks found. ${result.withKey} of ${result.candidates} candidates have a known key. Loosen the filters or raise the tolerance.`,
    );
  } catch (error) {
    if (!stale()) setStatus(`Error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (!stale()) setLoading(false);
  }
}

function startWith(track: Track): void {
  els.choices.replaceChildren();
  set = [track];
  avoid = [];
  saveSet();
  renderSet();
  void refresh();
}

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const value = els.input.value.trim();
  if (!value) return;
  setStatus("Searching track …");
  els.choices.replaceChildren();
  els.status.classList.add("busy");
  try {
    const matches = await resolveStart(engine, value);
    els.status.classList.remove("busy");
    if (matches.length === 0) {
      setStatus("Nothing found. Try artist and title as text.");
      return;
    }
    if (matches.length === 1) {
      startWith(matches[0]);
      return;
    }
    setStatus("Which track do you mean?");
    els.choices.replaceChildren(
      ...matches.slice(0, 8).map((m) => {
        const button = el("button", "choice");
        button.type = "button";
        const meta = el("div", "meta");
        meta.append(el("div", "title", m.title), el("div", "artist", m.artist));
        button.append(cover(m), meta);
        button.addEventListener("click", () => startWith(m));
        return button;
      }),
    );
  } catch (error) {
    els.status.classList.remove("busy");
    setStatus(`Error: ${error instanceof Error ? error.message : String(error)}`);
  }
});

els.refresh.addEventListener("click", () => void refresh());
[els.harmonic, els.sameKey, els.genre, els.direction, els.tolerance, els.underground].forEach((input) =>
  input.addEventListener("change", filtersChanged),
);

els.clearSet.addEventListener("click", () => {
  set = [];
  avoid = [];
  run++;
  setLoading(false);
  saveSet();
  renderSet();
  els.suggestions.replaceChildren();
  setStatus("");
});

els.exportSet.addEventListener("click", async () => {
  const text = set.map((t, i) => `${i + 1}. ${t.artist} – ${t.title} (${keyLabel(t)}, ${bpmLabel(t)})`).join("\n");
  try {
    await navigator.clipboard.writeText(text);
    setStatus("Set copied to clipboard.");
  } catch {
    setStatus("Could not copy.");
  }
});

renderSet();
if (set.length > 0) void refresh();
