<script lang="ts">
  import { onMount } from "svelte";
  import { LocateFixed } from "@lucide/svelte";
  import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
  import type { GeoBounds, ProjectConfigV1 } from "@topostack/core";
  let { project, onLocationChange }: { project: ProjectConfigV1; onLocationChange: (lat: number, lon: number, zoom: number, bounds: GeoBounds) => void } = $props();
  let container: HTMLDivElement;
  let guide: HTMLDivElement;
  let map: MapLibreMap | undefined;

  onMount(() => {
    map = new maplibregl.Map({ container, style: "https://tiles.openfreemap.org/styles/liberty", center: [project.location.lon, project.location.lat], zoom: project.location.zoom, attributionControl: false, cooperativeGestures: true });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
    const emitSelection = () => {
      if (!map) return;
      const center = map.getCenter();
      const containerRect = container.getBoundingClientRect();
      const guideRect = guide.getBoundingClientRect();
      const northWest = map.unproject([guideRect.left - containerRect.left, guideRect.top - containerRect.top]);
      const southEast = map.unproject([guideRect.right - containerRect.left, guideRect.bottom - containerRect.top]);
      onLocationChange(center.lat, center.lng, map.getZoom(), { west: northWest.lng, north: northWest.lat, east: southEast.lng, south: southEast.lat });
    };
    map.on("moveend", emitSelection);
    map.on("load", emitSelection);
    return () => { map?.remove(); map = undefined; };
  });

  $effect(() => {
    const lat = project.location.lat; const lon = project.location.lon; const zoom = project.location.zoom;
    if (!map) return;
    const center = map.getCenter();
    if (Math.abs(center.lat - lat) > 0.0001 || Math.abs(center.lng - lon) > 0.0001) map.flyTo({ center: [lon, lat], zoom, duration: 900 });
  });
</script>

<div class="map-wrap">
  <div bind:this={container} class="map-canvas"></div>
  <div bind:this={guide} class={`crop-guide crop-${project.cropShape}`} style:aspect-ratio={`${project.widthMm} / ${project.heightMm}`} aria-hidden="true"><span class="crop-corner crop-corner-a"></span><span class="crop-corner crop-corner-b"></span><span class="crop-corner crop-corner-c"></span><span class="crop-corner crop-corner-d"></span></div>
  <div class="map-crosshair"><span></span><span></span></div>
  <div class="map-caption"><LocateFixed size={14} /> Drag the map to choose your terrain</div>
</div>
