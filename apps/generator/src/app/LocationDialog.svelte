<script lang="ts">
  import { onMount } from "svelte";
  import { Map as MapIcon, Mountain, Search } from "@lucide/svelte";
  import { Button, Field, IconButton, Input, NumberField } from "@loidolt/theme-svelte";
  import type { ProjectConfigV1 } from "@topostack/core";
  import { searchPlaces, type PlaceResult } from "../data-provider";

  let { project, presets, onChoose, onCoordinates, onClose }: { project: ProjectConfigV1; presets: PlaceResult[]; onChoose: (place: PlaceResult) => void; onCoordinates: (lat: number, lon: number) => void; onClose: () => void } = $props();
  let query = $state("");
  let results = $state.raw<PlaceResult[]>([]);
  let searchError = $state("");
  let dialog: HTMLDialogElement;

  onMount(() => {
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  });

  function closeFromBackdrop(event: MouseEvent): void {
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  }

  function commitCoordinate(value: number, axis: "lat" | "lon"): void {
    if (!Number.isFinite(value)) return;
    if (axis === "lat") onCoordinates(Math.max(-85.0511, Math.min(85.0511, value)), project.location.lon);
    else onCoordinates(project.location.lat, Math.max(-180, Math.min(180, value)));
  }

  $effect(() => {
    const term = query.trim();
    if (term.length < 2) { results = []; searchError = ""; return; }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => { void searchPlaces(term, controller.signal).then((items) => { results = items; searchError = items.length ? "" : "No places found."; }).catch(() => { if (!controller.signal.aborted) searchError = "Search needs the map API. You can still enter coordinates or pan the map."; }); }, 300);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  });
</script>

<dialog bind:this={dialog} class="ldt-dialog ldt-dialog--lg search-modal" aria-labelledby="location-dialog-title" aria-describedby="location-dialog-description" onclose={onClose} onmousedown={closeFromBackdrop}>
  <header class="ldt-dialog__header"><div><h2 id="location-dialog-title" class="ldt-dialog__title">Choose anywhere</h2><p id="location-dialog-description" class="ldt-dialog__description">Search for a mountain, lake, park, city, or address.</p></div><IconButton label="Close dialog" onclick={() => dialog.close()}>×</IconButton></header>
  <div class="ldt-dialog__body">
    <label class="search-input"><Search size={19} /><Input autofocus aria-label="Search places" bind:value={query} placeholder="Try ‘Rocky Mountain National Park’" boxed /></label>
    <div class="coordinate-row">
      <Field label="Latitude">{#snippet children({ id })}<NumberField {id} label="Latitude" min={-85.0511} max={85.0511} step={0.0001} value={project.location.lat} boxed oninput={(event) => event.currentTarget.value !== "" && commitCoordinate(event.currentTarget.valueAsNumber, "lat")} onValueChange={(value) => commitCoordinate(value, "lat")} />{/snippet}</Field>
      <Field label="Longitude">{#snippet children({ id })}<NumberField {id} label="Longitude" min={-180} max={180} step={0.0001} value={project.location.lon} boxed oninput={(event) => event.currentTarget.value !== "" && commitCoordinate(event.currentTarget.valueAsNumber, "lon")} onValueChange={(value) => commitCoordinate(value, "lon")} />{/snippet}</Field>
      <Button onclick={() => dialog.close()}>Use coordinates</Button>
    </div>
    <div class="search-results">
      {#each results as result (result.id)}<button onclick={() => onChoose(result)}><span><MapIcon size={17} /></span><span><strong>{result.label.split(",")[0]}</strong><small>{result.label.split(",").slice(1).join(",")}</small></span></button>{/each}
      {#if searchError}<p role="status">{searchError}</p>{/if}
      {#if !query}<div class="preset-grid">{#each presets as preset (preset.id)}<button onclick={() => onChoose(preset)}><Mountain size={21} /><span><strong>{preset.label.split(",")[0]}</strong><small>{preset.label.split(",").slice(1).join(",")}</small></span></button>{/each}</div>{/if}
    </div>
    <small class="provider-attribution">Place search by <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">Geoapify</a> · © OpenStreetMap contributors</small>
  </div>
</dialog>
