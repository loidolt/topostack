<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { LocateFixed } from "@lucide/svelte";
  import * as maplibregl from "maplibre-gl";
  import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
  import { markerSymbolCenterForAnchor, markerSymbolPaths, unwrapLongitude, type CustomLineFeatureV1, type GeoBounds, type MapMarkerV1, type MarkerSymbol, type ProjectConfigV1 } from "@topostack/core";
  import { boundsForProject } from "../data-provider";
  let { project, onLocationChange, onUnavailable }: { project: ProjectConfigV1; onUnavailable?: () => void; onLocationChange: (lat: number, lon: number, zoom: number, bounds: GeoBounds) => void } = $props();
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

  function fitSelection(): void {
    if (!map || !guide) return;
    const bounds = boundsForProject(project);
    const radians = Math.PI / 180;
    const northY = Math.asinh(Math.tan(bounds.north * radians));
    const southY = Math.asinh(Math.tan(bounds.south * radians));
    const aspect = ((bounds.east - bounds.west) * radians) / (northY - southY);
    const width = Math.min(container.clientWidth * 0.54, 630, container.clientHeight * 0.7 * aspect);
    const height = width / aspect;
    if (!(width > 0 && height > 0)) return;
    guide.style.width = `${width}px`;
    guide.style.height = `${height}px`;
    map.resize({ topostackProgrammatic: true });
    map.fitBounds([[bounds.west, bounds.south], [bounds.east, bounds.north]], {
      padding: { left: (container.clientWidth - width) / 2, right: (container.clientWidth - width) / 2, top: (container.clientHeight - height) / 2, bottom: (container.clientHeight - height) / 2 },
      duration: 0, bearing: 0, pitch: 0,
    }, { topostackProgrammatic: true });
  }

  function customLineData(lines: CustomLineFeatureV1[]) {
    const longitudeBounds = project.location.bounds ?? { west: project.location.lon - 180, east: project.location.lon + 180, south: -85.0511, north: 85.0511 };
    return {
      type: "FeatureCollection" as const,
      features: lines.map((line) => ({
        type: "Feature" as const,
        properties: { id: line.id, kind: line.kind },
        geometry: { type: "LineString" as const, coordinates: line.points.map((point) => [unwrapLongitude(point.lon, longitudeBounds), point.lat] as [number, number]) },
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
    try {
      map = new maplibregl.Map({ container, style: "https://tiles.openfreemap.org/styles/liberty", center: [project.location.lon, project.location.lat], zoom: project.location.zoom, attributionControl: false, cooperativeGestures: true, dragRotate: false, touchPitch: false, trackResize: false });
    } catch { onUnavailable?.(); return; }
    map.touchZoomRotate.disableRotation();
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
      const longitude = ((center.lng + 180) % 360 + 360) % 360 - 180;
      const worldShift = longitude - center.lng;
      onLocationChange(center.lat, longitude, map.getZoom(), { west: northWest.lng + worldShift, north: northWest.lat, east: southEast.lng + worldShift, south: southEast.lat });
    };
    // Only commit selections for movement the user caused. Programmatic camera
    // moves (initial load, flyTo from external location edits) must not
    // overwrite the stored place label or bounds.
    map.on("moveend", (event) => { if ((event as unknown as { topostackProgrammatic?: boolean }).topostackProgrammatic) return; emitSelection(); });
    const resizeObserver = new ResizeObserver(() => fitSelection());
    resizeObserver.observe(container);
    fitSelection();
    return () => { resizeObserver.disconnect(); mapMarkers.forEach((marker) => marker.remove()); mapMarkers.clear(); map?.remove(); map = undefined; };
  });

  $effect(() => {
    void project.location;
    void project.cropShape;
    void project.widthMm;
    void project.heightMm;
    untrack(fitSelection);
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
  <div bind:this={guide} class="crop-guide" class:crop-circle={isCircle} aria-hidden="true">{#if isCircle}<div class="circle-outline" style:width={`${100 * Math.min(project.widthMm, project.heightMm) / project.widthMm}%`} style:height={`${100 * Math.min(project.widthMm, project.heightMm) / project.heightMm}%`}></div>{:else}<span class="crop-corner crop-corner-a"></span><span class="crop-corner crop-corner-b"></span><span class="crop-corner crop-corner-c"></span><span class="crop-corner crop-corner-d"></span>{/if}</div>
  <div class="map-crosshair"><span></span><span></span></div>
  <div class="map-caption"><LocateFixed size={14} /> Drag the map to choose your terrain</div>
</div>

<style>
  .circle-outline {
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    border: 2px solid white;
    border-radius: 50%;
    box-shadow: 0 0 0 9999px #20231d61;
  }

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
