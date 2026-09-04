<script lang="ts">
  import { onMount } from "svelte";
  import { LocateFixed } from "@lucide/svelte";
  import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
  import type { GeoBounds, ProjectConfigV1 } from "@topostack/core";
  let { project, onLocationChange }: { project: ProjectConfigV1; onLocationChange: (lat: number, lon: number, zoom: number, bounds: GeoBounds) => void } = $props();
  let container: HTMLDivElement;
  let guide: HTMLDivElement;
  let map: MapLibreMap | undefined;
  const isCircle = $derived(project.cropShape === "circle");

  function mapAreaAspect(): number {
    const bounds = project.location.bounds;
    if (!bounds) return 1.5;
    const radians = Math.PI / 180;
    const northY = Math.asinh(Math.tan(bounds.north * radians));
    const southY = Math.asinh(Math.tan(bounds.south * radians));
    return Math.max(0.1, Math.min(10, ((bounds.east - bounds.west) * radians) / Math.abs(northY - southY)));
  }

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
    // Only commit selections for movement the user caused. Programmatic camera
    // moves (initial load, flyTo from external location edits) must not
    // overwrite the stored place label or bounds.
    map.on("moveend", (event) => { if ((event as unknown as { topostackProgrammatic?: boolean }).topostackProgrammatic) return; emitSelection(); });
    return () => { map?.remove(); map = undefined; };
  });

  $effect(() => {
    const lat = project.location.lat; const lon = project.location.lon; const zoom = project.location.zoom;
    if (!map) return;
    const center = map.getCenter();
    if (Math.abs(center.lat - lat) > 0.0001 || Math.abs(center.lng - lon) > 0.0001) map.flyTo({ center: [lon, lat], zoom, duration: 900 }, { topostackProgrammatic: true });
  });
</script>

<div class="map-wrap">
  <div bind:this={container} class="map-canvas"></div>
  <div bind:this={guide} class="crop-guide" class:crop-circle={isCircle} style:aspect-ratio={isCircle ? "1" : mapAreaAspect()} aria-hidden="true"><span class="crop-corner crop-corner-a"></span><span class="crop-corner crop-corner-b"></span><span class="crop-corner crop-corner-c"></span><span class="crop-corner crop-corner-d"></span></div>
  <div class="map-crosshair"><span></span><span></span></div>
  <div class="map-caption"><LocateFixed size={14} /> Drag the map to choose your terrain</div>
</div>
