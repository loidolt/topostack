<script lang="ts">
  import { onMount } from "svelte";
  import { LocateFixed } from "@lucide/svelte";
  import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
  import { markerSymbolCenterForAnchor, markerSymbolPaths, type CustomLineFeatureV1, type GeoBounds, type MapMarkerV1, type MarkerSymbol, type ProjectConfigV1 } from "@topostack/core";
  let { project, onLocationChange }: { project: ProjectConfigV1; onLocationChange: (lat: number, lon: number, zoom: number, bounds: GeoBounds) => void } = $props();
  let container: HTMLDivElement;
  let guide: HTMLDivElement;
  let map: MapLibreMap | undefined;
  const mapMarkers = new Map<string, maplibregl.Marker>();
  const isCircle = $derived(project.cropShape === "circle");
  const CUSTOM_SOURCE_ID = "topostack-custom-lines";
  const CUSTOM_TRAIL_LAYER_ID = "topostack-custom-trails";
  const CUSTOM_BOUNDARY_LAYER_ID = "topostack-custom-boundaries";
  const MARKER_SYMBOL_SIZE = 22;
  const MARKER_VIEWBOX_SIZE = 26;
  const MARKER_ELEMENT_SIZE_PX = 30;

  function markerPixelOffset(symbol: MarkerSymbol): [number, number] {
    const center = markerSymbolCenterForAnchor(symbol, { x: 0, y: 0 }, MARKER_SYMBOL_SIZE);
    const scale = MARKER_ELEMENT_SIZE_PX / MARKER_VIEWBOX_SIZE;
    return [center.x * scale, center.y * scale];
  }

  function markerElement(marker: MapMarkerV1): HTMLDivElement {
    const element = document.createElement("div");
    element.className = "topostack-map-marker";
    element.dataset.symbol = marker.symbol;
    element.setAttribute("role", "img");
    element.setAttribute("aria-label", `${marker.symbol} marker at ${marker.lat.toFixed(5)}, ${marker.lon.toFixed(5)}`);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "-13 -13 26 26");
    svg.setAttribute("aria-hidden", "true");
    for (const points of markerSymbolPaths(marker.symbol, { x: 0, y: 0 }, MARKER_SYMBOL_SIZE)) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`).join(" "));
      svg.append(path);
    }
    element.append(svg);
    return element;
  }

  function mapAreaAspect(): number {
    const bounds = project.location.bounds;
    if (!bounds) return 1.5;
    const radians = Math.PI / 180;
    const northY = Math.asinh(Math.tan(bounds.north * radians));
    const southY = Math.asinh(Math.tan(bounds.south * radians));
    return Math.max(0.1, Math.min(10, ((bounds.east - bounds.west) * radians) / Math.abs(northY - southY)));
  }

  function customLineData(lines: CustomLineFeatureV1[]) {
    return {
      type: "FeatureCollection" as const,
      features: lines.map((line) => ({
        type: "Feature" as const,
        properties: { id: line.id, kind: line.kind },
        geometry: { type: "LineString" as const, coordinates: line.points.map((point) => [point.lon, point.lat] as [number, number]) },
      })),
    };
  }

  function syncCustomLines(lines: CustomLineFeatureV1[]): void {
    if (!map || !map.isStyleLoaded()) return;
    const data = customLineData(lines);
    const source = map.getSource(CUSTOM_SOURCE_ID) as GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
      return;
    }
    map.addSource(CUSTOM_SOURCE_ID, { type: "geojson", data });
    map.addLayer({
      id: CUSTOM_BOUNDARY_LAYER_ID,
      type: "line",
      source: CUSTOM_SOURCE_ID,
      filter: ["==", ["get", "kind"], "boundary"],
      paint: { "line-color": "#75415d", "line-width": 3, "line-dasharray": [7, 4] },
      layout: { "line-cap": "round", "line-join": "round" },
    });
    map.addLayer({
      id: CUSTOM_TRAIL_LAYER_ID,
      type: "line",
      source: CUSTOM_SOURCE_ID,
      filter: ["==", ["get", "kind"], "trail"],
      paint: { "line-color": "#b8682d", "line-width": 3, "line-dasharray": [3, 2] },
      layout: { "line-cap": "round", "line-join": "round" },
    });
  }

  onMount(() => {
    map = new maplibregl.Map({ container, style: "https://tiles.openfreemap.org/styles/liberty", center: [project.location.lon, project.location.lat], zoom: project.location.zoom, attributionControl: false, cooperativeGestures: true });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
    map.on("load", () => syncCustomLines(project.customLines));
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
    return () => { mapMarkers.forEach((marker) => marker.remove()); mapMarkers.clear(); map?.remove(); map = undefined; };
  });

  $effect(() => {
    const lat = project.location.lat; const lon = project.location.lon; const zoom = project.location.zoom;
    if (!map) return;
    const center = map.getCenter();
    if (Math.abs(center.lat - lat) > 0.0001 || Math.abs(center.lng - lon) > 0.0001) map.flyTo({ center: [lon, lat], zoom, duration: 900 }, { topostackProgrammatic: true });
  });

  $effect(() => {
    const configuredMarkers = project.markers;
    if (!map) return;
    const activeIds = new Set(configuredMarkers.map((marker) => marker.id));
    for (const [id, rendered] of mapMarkers) {
      if (!activeIds.has(id)) { rendered.remove(); mapMarkers.delete(id); }
    }
    for (const marker of configuredMarkers) {
      let rendered = mapMarkers.get(marker.id);
      if (rendered?.getElement().dataset.symbol !== marker.symbol) {
        rendered?.remove();
        rendered = undefined;
      }
      if (!rendered) {
        rendered = new maplibregl.Marker({ element: markerElement(marker), anchor: "center", offset: markerPixelOffset(marker.symbol) }).setLngLat([marker.lon, marker.lat]).addTo(map);
        mapMarkers.set(marker.id, rendered);
      } else {
        rendered.setLngLat([marker.lon, marker.lat]);
        rendered.getElement().setAttribute("aria-label", `${marker.symbol} marker at ${marker.lat.toFixed(5)}, ${marker.lon.toFixed(5)}`);
      }
    }
  });

  $effect(() => {
    const lines = project.customLines;
    syncCustomLines(lines);
  });
</script>

<div class="map-wrap">
  <div bind:this={container} class="map-canvas"></div>
  <div bind:this={guide} class="crop-guide" class:crop-circle={isCircle} style:aspect-ratio={isCircle ? "1" : mapAreaAspect()} aria-hidden="true"><span class="crop-corner crop-corner-a"></span><span class="crop-corner crop-corner-b"></span><span class="crop-corner crop-corner-c"></span><span class="crop-corner crop-corner-d"></span></div>
  <div class="map-crosshair"><span></span><span></span></div>
  <div class="map-caption"><LocateFixed size={14} /> Drag the map to choose your terrain</div>
</div>

<style>
  :global(.topostack-map-marker) {
    width: 30px;
    height: 30px;
    color: #b84824;
    filter: drop-shadow(0 1px 1px rgb(0 0 0 / 0.55));
    pointer-events: none;
  }

  :global(.topostack-map-marker svg) {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
    fill: currentColor;
    stroke: #fff;
    stroke-width: 4.8;
    stroke-linecap: round;
    stroke-linejoin: round;
    paint-order: stroke fill;
  }
</style>
