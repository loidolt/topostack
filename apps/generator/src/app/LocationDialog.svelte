<script lang="ts">
  import { onMount } from "svelte";
  import { Map as MapIcon, Mountain, Search, X } from "@lucide/svelte";
  import type { ProjectConfigV1 } from "@topostack/core";
  import { searchPlaces, type PlaceResult } from "../data-provider";

  let { project, presets, onChoose, onCoordinates, onClose }: { project: ProjectConfigV1; presets: PlaceResult[]; onChoose: (place: PlaceResult) => void; onCoordinates: (lat: number, lon: number) => void; onClose: () => void } = $props();
  let dialog: HTMLElement;
  let searchInput: HTMLInputElement;
  let query = $state("");
  let results = $state.raw<PlaceResult[]>([]);
  let searchError = $state("");

  onMount(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    searchInput.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href], [tabindex="0"]')];
      const first = focusable[0]; const last = focusable.at(-1); if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); previous?.focus(); };
  });

  $effect(() => {
    const term = query.trim();
    if (term.length < 2) { results = []; searchError = ""; return; }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => { void searchPlaces(term, controller.signal).then((items) => { results = items; searchError = items.length ? "" : "No places found."; }).catch(() => { if (!controller.signal.aborted) searchError = "Search needs the map API. You can still enter coordinates or pan the map."; }); }, 300);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  });
</script>

<div class="modal-backdrop" role="presentation" onmousedown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
  <div bind:this={dialog} class="search-modal" role="dialog" aria-modal="true" aria-labelledby="location-dialog-title">
    <header><div><span id="location-dialog-title">Choose anywhere</span><small>Search for a mountain, lake, park, city, or address.</small></div><button onclick={onClose} aria-label="Close"><X size={19} /></button></header>
    <label class="search-input"><Search size={19} /><input bind:this={searchInput} aria-label="Search places" bind:value={query} placeholder="Try ‘Rocky Mountain National Park’" /></label>
    <div class="coordinate-row"><label>Latitude<input type="number" min="-85.0511" max="85.0511" value={project.location.lat} oninput={(event) => onCoordinates(Number(event.currentTarget.value), project.location.lon)} /></label><label>Longitude<input type="number" min="-180" max="180" value={project.location.lon} oninput={(event) => onCoordinates(project.location.lat, Number(event.currentTarget.value))} /></label><button onclick={onClose}>Use coordinates</button></div>
    <div class="search-results">
      {#each results as result (result.id)}<button onclick={() => onChoose(result)}><span><MapIcon size={17} /></span><span><strong>{result.label.split(",")[0]}</strong><small>{result.label.split(",").slice(1).join(",")}</small></span></button>{/each}
      {#if searchError}<p role="status">{searchError}</p>{/if}
      {#if !query}<div class="preset-grid">{#each presets as preset (preset.id)}<button onclick={() => onChoose(preset)}><Mountain size={21} /><span><strong>{preset.label.split(",")[0]}</strong><small>{preset.label.split(",").slice(1).join(",")}</small></span></button>{/each}</div>{/if}
    </div>
    <small class="provider-attribution">Place search by <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">Geoapify</a> · © OpenStreetMap contributors</small>
  </div>
</div>
