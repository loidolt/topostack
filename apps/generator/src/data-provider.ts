import { createSyntheticSource, type GeoBounds, type MarkingFeature, type Point2D, type Polygon2D, type ProjectConfigV1, type SourceBundleV1, type TransportationClass } from "@topostack/core";
import { PMTiles } from "pmtiles";
import { classifyRings, VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import polygonClipping, { type MultiPolygon, type Pair } from "polygon-clipping";
import { MAP_DATA_ATTRIBUTION } from "./map-attribution";

export interface PlaceResult { id: string; label: string; lat: number; lon: number; type?: string }

const configuredApiBase = (import.meta.env.VITE_MAP_API_URL as string | undefined)?.replace(/\/$/, "");
// Wrangler's default 8787 is often taken, so `npm run dev` (and a standalone
// `npm run dev:web`) can retarget the local API with VITE_MAP_API_PORT.
const developmentApiPort = (import.meta.env.VITE_MAP_API_PORT as string | undefined) || "8787";
const developmentApiBase = import.meta.env.DEV ? `http://localhost:${developmentApiPort}` : undefined;
// Standalone deployments serve the app and API from the same Worker. Atomm
// packages still inject an explicit API URL during their build.
const apiBase = configuredApiBase ?? developmentApiBase ?? "";
const vectorArchive = new PMTiles(`${apiBase}/v1/osm.pmtiles`);
const TILE_SIZE = 256;
const MAX_DATA_TILES = 24;
const MAJOR_ROAD_DETAILS = new Set(["motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link"]);
const LOCAL_ROAD_DETAILS = new Set(["tertiary", "tertiary_link", "residential", "service", "unclassified", "road", "raceway", "driveway", "parking_aisle", "alley", "drive-through", "emergency_access"]);
const TRAIL_DETAILS = new Set(["pedestrian", "track", "path", "cycleway", "bridleway", "steps", "corridor", "sidewalk", "crossing"]);
const EXCLUDED_TRANSPORT_KINDS = new Set(["rail", "aerialway", "ferry", "pier", "aeroway"]);
const worldSize = (zoom: number) => TILE_SIZE * 2 ** zoom;
const lonToWorldX = (lon: number, zoom: number) => ((lon + 180) / 360) * worldSize(zoom);
function latToWorldY(lat: number, zoom: number): number {
  const radians = Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180;
  return ((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * worldSize(zoom);
}
const worldXToLon = (x: number, zoom: number) => (x / worldSize(zoom)) * 360 - 180;
function worldYToLat(y: number, zoom: number): number {
  return Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / worldSize(zoom)))) * 180 / Math.PI;
}

export function boundsForProject(config: ProjectConfigV1): GeoBounds {
  if (config.location.bounds) return config.location.bounds;
  const zoom = Math.max(0, Math.min(15, Math.round(config.location.zoom)));
  const centerX = lonToWorldX(config.location.lon, zoom);
  const centerY = latToWorldY(config.location.lat, zoom);
  const widthPx = 420;
  const heightPx = 280;
  return { west: worldXToLon(centerX - widthPx / 2, zoom), east: worldXToLon(centerX + widthPx / 2, zoom), north: worldYToLat(centerY - heightPx / 2, zoom), south: worldYToLat(centerY + heightPx / 2, zoom) };
}

interface TileWindow { zoom: number; westX: number; eastX: number; northY: number; southY: number; tiles: Array<{ x: number; y: number; z: number }> }
function tileWindow(bounds: GeoBounds, zoom: number): TileWindow {
  const westX = lonToWorldX(bounds.west, zoom);
  const eastX = lonToWorldX(bounds.east, zoom);
  const northY = latToWorldY(bounds.north, zoom);
  const southY = latToWorldY(bounds.south, zoom);
  const scale = 2 ** zoom;
  const minX = Math.max(0, Math.floor(westX / TILE_SIZE));
  const maxX = Math.min(scale - 1, Math.floor((eastX - 1e-6) / TILE_SIZE));
  const minY = Math.max(0, Math.floor(northY / TILE_SIZE));
  const maxY = Math.min(scale - 1, Math.floor((southY - 1e-6) / TILE_SIZE));
  const tiles: TileWindow["tiles"] = [];
  for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) tiles.push({ x, y, z: zoom });
  if (!tiles.length || tiles.length > MAX_DATA_TILES) throw new Error("The selected area is too large at this zoom. Zoom in and try again.");
  return { zoom, westX, eastX, northY, southY, tiles };
}

export function classifyTransportation(properties: Record<string, unknown>): TransportationClass | undefined {
  const kind = typeof properties.kind === "string" ? properties.kind : "";
  const detail = typeof properties.kind_detail === "string" ? properties.kind_detail : "";
  if (EXCLUDED_TRANSPORT_KINDS.has(kind)) return undefined;
  if (kind === "path" || TRAIL_DETAILS.has(detail)) return "trail";
  if (kind === "highway" || kind === "major_road" || MAJOR_ROAD_DETAILS.has(detail)) return "major-road";
  if (kind === "minor_road" || LOCAL_ROAD_DETAILS.has(detail)) return "local-road";
  return undefined;
}

export function transportationLabel(properties: Record<string, unknown>): string | undefined {
  for (const key of ["name", "ref", "shield_text"] as const) {
    const value = properties[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

// Vector tiles deliberately repeat linework in a buffer outside each tile so a
// map renderer can draw seamless strokes. Fabrication geometry cannot retain
// that buffer: adjacent tiles would score or engrave the same path several times.
export function clipVectorTileLine(points: Point2D[], extent: number): Point2D[][] {
  if (points.length < 2 || !(extent > 0)) return [];
  const result: Point2D[][] = [];
  let active: Point2D[] = [];
  const samePoint = (left: Point2D, right: Point2D) => Math.hypot(left.x - right.x, left.y - right.y) <= 1e-7;
  const flush = () => {
    if (active.length > 1) result.push(active);
    active = [];
  };
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]!;
    const end = points[index + 1]!;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    let entry = 0;
    let exit = 1;
    let visible = true;
    for (const [p, q] of [[-dx, start.x], [dx, extent - start.x], [-dy, start.y], [dy, extent - start.y]] as Array<[number, number]>) {
      if (Math.abs(p) <= 1e-12) {
        if (q < 0) { visible = false; break; }
        continue;
      }
      const ratio = q / p;
      if (p < 0) entry = Math.max(entry, ratio);
      else exit = Math.min(exit, ratio);
      if (entry > exit) { visible = false; break; }
    }
    if (!visible || exit - entry <= 1e-12) {
      flush();
      continue;
    }
    const clippedStart = { x: start.x + dx * entry, y: start.y + dy * entry };
    const clippedEnd = { x: start.x + dx * exit, y: start.y + dy * exit };
    const previous = active.at(-1);
    if (!previous || !samePoint(previous, clippedStart)) {
      flush();
      active = [clippedStart];
    }
    if (!samePoint(active.at(-1)!, clippedEnd)) active.push(clippedEnd);
  }
  flush();
  return result;
}

function pointKey(point: Point2D, toleranceMm = 1e-4): string {
  return `${Math.round(point.x / toleranceMm)},${Math.round(point.y / toleranceMm)}`;
}

function samePoint(left: Point2D, right: Point2D, tolerance = 1e-7): boolean {
  return Math.hypot(left.x - right.x, left.y - right.y) <= tolerance;
}

function pathLength(points: Point2D[]): number {
  let length = 0;
  for (let index = 0; index < points.length - 1; index += 1) length += Math.hypot(points[index + 1]!.x - points[index]!.x, points[index + 1]!.y - points[index]!.y);
  return length;
}

function distanceToSegment(point: Point2D, start: Point2D, end: Point2D): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-12) return Math.hypot(point.x - start.x, point.y - start.y);
  const ratio = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + dx * ratio), point.y - (start.y + dy * ratio));
}

function simplifyPath(points: Point2D[], tolerance: number): Point2D[] {
  if (points.length < 3 || tolerance <= 0) return points;
  const closed = samePoint(points[0]!, points.at(-1)!);
  const source = closed ? points.slice(0, -1) : points;
  if (source.length < 3) return points;
  const keep = new Uint8Array(source.length);
  keep[0] = 1;
  keep[source.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, source.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let maximum = tolerance;
    let selected = -1;
    for (let index = start + 1; index < end; index += 1) {
      const distance = distanceToSegment(source[index]!, source[start]!, source[end]!);
      if (distance > maximum) { maximum = distance; selected = index; }
    }
    if (selected > 0) {
      keep[selected] = 1;
      stack.push([start, selected], [selected, end]);
    }
  }
  const simplified = source.filter((_, index) => keep[index] === 1);
  if (closed && simplified[0]) simplified.push({ ...simplified[0] });
  return simplified;
}

function ringIsLargeEnough(points: Point2D[], minimumFeatureMm: number): boolean {
  if (points.length < 4) return false;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return Math.max(...xs) - Math.min(...xs) >= minimumFeatureMm && Math.max(...ys) - Math.min(...ys) >= minimumFeatureMm;
}

/** Dissolve vector-tile polygon fragments before extracting their shorelines. */
export function dissolveWaterPolygons(polygons: Polygon2D[], minimumFeatureMm: number): MarkingFeature[] {
  if (!polygons.length) return [];
  const inputs: MultiPolygon[] = polygons.map((polygon) => [[
    polygon.outer.map((point) => [point.x, point.y] as Pair),
    ...polygon.holes.map((ring) => ring.map((point) => [point.x, point.y] as Pair)),
  ]]);
  const dissolved = polygonClipping.union(inputs[0]!, ...inputs.slice(1));
  const tolerance = minimumFeatureMm * 0.18;
  const markings: MarkingFeature[] = [];
  dissolved.forEach((polygon, polygonIndex) => polygon.forEach((ring, ringIndex) => {
    const points = simplifyPath(ring.map(([x, y]) => ({ x, y })), tolerance);
    if (!samePoint(points[0]!, points.at(-1)!)) points.push({ ...points[0]! });
    if (!ringIsLargeEnough(points, minimumFeatureMm)) return;
    markings.push({ id: `water-area-${polygonIndex}-shore-${ringIndex}`, kind: "water", operation: "score", points });
  }));
  return markings;
}

/** Remove buffered duplicates and join continuous river/stream tile pieces. */
export function cleanWaterwayMarkings(markings: MarkingFeature[], minimumFeatureMm: number): MarkingFeature[] {
  const unique: MarkingFeature[] = [];
  const paths = new Set<string>();
  for (const marking of markings) {
    if (marking.points.length < 2) continue;
    const forward = marking.points.map((point) => pointKey(point)).join(";");
    const reverse = [...marking.points].reverse().map((point) => pointKey(point)).join(";");
    const key = forward < reverse ? forward : reverse;
    if (!paths.has(key)) { paths.add(key); unique.push(marking); }
  }
  const endpoints = new Map<string, Set<number>>();
  unique.forEach((marking, index) => {
    for (const point of [marking.points[0]!, marking.points.at(-1)!]) {
      const key = pointKey(point);
      const owners = endpoints.get(key) ?? new Set<number>();
      owners.add(index);
      endpoints.set(key, owners);
    }
  });
  const used = new Set<number>();
  const result: MarkingFeature[] = [];
  unique.forEach((marking, markingIndex) => {
    if (used.has(markingIndex)) return;
    used.add(markingIndex);
    const points = [...marking.points];
    let extended = true;
    while (extended) {
      extended = false;
      for (const atStart of [false, true]) {
        const shared = atStart ? points[0]! : points.at(-1)!;
        const owners = endpoints.get(pointKey(shared));
        if (owners?.size !== 2) continue;
        const nextIndex = [...owners].find((index) => !used.has(index));
        if (nextIndex === undefined) continue;
        const next = unique[nextIndex]!;
        const oriented = pointKey(next.points[0]!) === pointKey(shared) ? [...next.points] : [...next.points].reverse();
        if (atStart) points.unshift(...oriented.reverse().slice(0, -1));
        else points.push(...oriented.slice(1));
        used.add(nextIndex);
        extended = true;
        break;
      }
    }
    const simplified = simplifyPath(points, minimumFeatureMm * 0.18);
    if (pathLength(simplified) >= minimumFeatureMm) result.push({ ...marking, id: `waterway-${result.length}`, points: simplified });
  });
  return result;
}

// Once tile buffers are removed, join matching road pieces at unambiguous
// degree-two endpoints. This keeps offset normals continuous around bends while
// preserving real forks and intersections as separate branches.
export function stitchTransportationMarkings(markings: MarkingFeature[]): MarkingFeature[] {
  const transportation = markings.filter((marking) => marking.transportationClass && marking.points.length > 1);
  const other = markings.filter((marking) => !marking.transportationClass || marking.points.length < 2);
  const groups = new Map<string, MarkingFeature[]>();
  for (const marking of transportation) {
    const key = `${marking.kind}\u0000${marking.transportationClass}\u0000${marking.label ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), marking]);
  }
  const stitched: MarkingFeature[] = [];
  for (const features of groups.values()) {
    const unique: MarkingFeature[] = [];
    const paths = new Set<string>();
    for (const feature of features) {
      const forward = feature.points.map((point) => pointKey(point)).join(";");
      const reverse = [...feature.points].reverse().map((point) => pointKey(point)).join(";");
      const key = forward < reverse ? forward : reverse;
      if (!paths.has(key)) { paths.add(key); unique.push(feature); }
    }
    const endpoints = new Map<string, Set<number>>();
    unique.forEach((feature, index) => {
      for (const point of [feature.points[0]!, feature.points.at(-1)!]) {
        const key = pointKey(point);
        const owners = endpoints.get(key) ?? new Set<number>();
        owners.add(index);
        endpoints.set(key, owners);
      }
    });
    const used = new Set<number>();
    unique.forEach((feature, featureIndex) => {
      if (used.has(featureIndex)) return;
      used.add(featureIndex);
      const points = [...feature.points];
      let extended = true;
      while (extended) {
        extended = false;
        for (const atStart of [false, true]) {
          const shared = atStart ? points[0]! : points.at(-1)!;
          const owners = endpoints.get(pointKey(shared));
          if (owners?.size !== 2) continue;
          const nextIndex = [...owners].find((index) => !used.has(index));
          if (nextIndex === undefined) continue;
          const next = unique[nextIndex]!;
          const sharesNextStart = pointKey(next.points[0]!) === pointKey(shared);
          const oriented = sharesNextStart ? [...next.points] : [...next.points].reverse();
          if (atStart) points.unshift(...oriented.reverse().slice(0, -1));
          else points.push(...oriented.slice(1));
          used.add(nextIndex);
          extended = true;
          break;
        }
      }
      stitched.push({ ...feature, points });
    });
  }
  return [...stitched, ...other];
}

// Terrarium tiles must be decoded to elevations at native resolution before any
// resampling. Scaling the PNGs with drawImage interpolates the R/G/B channels
// independently (the R channel alone is worth 256 m per step) and antialiases
// each tile's edge against the empty canvas, which decodes to -32768 m — that
// combination produced false contour walls along every tile seam.
async function loadElevation(window: TileWindow, signal?: AbortSignal): Promise<{ elevation: SourceBundleV1["elevation"]; imagerySources: string[]; datasetVersion: string }> {
  const responses = await Promise.all(window.tiles.map(async (tile) => {
    const response = await fetch(`${apiBase}/v1/terrain/${tile.z}/${tile.x}/${tile.y}.png`, { signal });
    if (!response.ok) throw new Error(`Terrain service returned ${response.status}.`);
    return { tile, response, bitmap: await createImageBitmap(await response.blob()) };
  }));
  const minTileX = Math.min(...window.tiles.map((tile) => tile.x));
  const minTileY = Math.min(...window.tiles.map((tile) => tile.y));
  const mosaicWidth = (Math.max(...window.tiles.map((tile) => tile.x)) - minTileX + 1) * TILE_SIZE;
  const mosaicHeight = (Math.max(...window.tiles.map((tile) => tile.y)) - minTileY + 1) * TILE_SIZE;
  const canvas = new OffscreenCanvas(mosaicWidth, mosaicHeight);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("This browser cannot decode elevation tiles.");
  context.imageSmoothingEnabled = false;
  const imagerySources = new Set<string>();
  const datasetVersions = new Set<string>();
  for (const { tile, response, bitmap } of responses) {
    const datasetVersion = response.headers.get("x-topostack-dataset");
    if (datasetVersion) datasetVersions.add(datasetVersion);
    response.headers.get("x-topostack-imagery-sources")?.split(",").map((value) => value.trim()).filter(Boolean).forEach((value) => imagerySources.add(value));
    context.drawImage(bitmap, (tile.x - minTileX) * TILE_SIZE, (tile.y - minTileY) * TILE_SIZE);
    bitmap.close();
  }
  if (datasetVersions.size > 1) throw new Error("Terrain tiles came from inconsistent dataset versions. Try again shortly.");
  const pixels = context.getImageData(0, 0, mosaicWidth, mosaicHeight).data;
  const mosaic = new Float32Array(mosaicWidth * mosaicHeight);
  for (let index = 0; index < mosaic.length; index += 1) {
    const pixel = index * 4;
    mosaic[index] = (pixels[pixel] ?? 0) * 256 + (pixels[pixel + 1] ?? 0) + (pixels[pixel + 2] ?? 0) / 256 - 32768;
  }

  // Output samples i in 0..width-1 span [westX, eastX] edge to edge, matching
  // the contourToMm/sampleElevation convention in core (grid.width - 1 spans
  // the full material width). Cap at the native pixel span so we never invent
  // resolution the tiles do not have.
  const spanX = window.eastX - window.westX;
  const spanY = window.southY - window.northY;
  const outputWidth = Math.max(64, Math.min(768, Math.round(spanX)));
  const outputHeight = Math.max(64, Math.min(768, Math.round(outputWidth * spanY / spanX)));
  const values = new Float32Array(outputWidth * outputHeight);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  const sampleMosaic = (x: number, y: number): number => {
    const clampedX = Math.max(0, Math.min(mosaicWidth - 1, x));
    const clampedY = Math.max(0, Math.min(mosaicHeight - 1, y));
    return mosaic[clampedY * mosaicWidth + clampedX] ?? 0;
  };
  for (let row = 0; row < outputHeight; row += 1) {
    // Native pixel centers sit at +0.5, so subtract it before interpolating.
    const worldY = window.northY + (spanY * row) / (outputHeight - 1) - minTileY * TILE_SIZE - 0.5;
    const y0 = Math.floor(worldY);
    const fy = worldY - y0;
    for (let column = 0; column < outputWidth; column += 1) {
      const worldX = window.westX + (spanX * column) / (outputWidth - 1) - minTileX * TILE_SIZE - 0.5;
      const x0 = Math.floor(worldX);
      const fx = worldX - x0;
      const top = sampleMosaic(x0, y0) * (1 - fx) + sampleMosaic(x0 + 1, y0) * fx;
      const bottom = sampleMosaic(x0, y0 + 1) * (1 - fx) + sampleMosaic(x0 + 1, y0 + 1) * fx;
      const elevation = top * (1 - fy) + bottom * fy;
      values[row * outputWidth + column] = elevation;
      min = Math.min(min, elevation);
      max = Math.max(max, elevation);
    }
  }
  return { elevation: { width: outputWidth, height: outputHeight, values, min, max }, imagerySources: [...imagerySources].sort(), datasetVersion: [...datasetVersions][0] ?? "mapzen-terrarium+protomaps-20260819-z12-v1" };
}

export async function loadVectorMarkings(bounds: GeoBounds, requestedZoom: number, config: ProjectConfigV1, signal?: AbortSignal): Promise<MarkingFeature[]> {
  const header = await vectorArchive.getHeader();
  signal?.throwIfAborted();
  let vectorZoom = Math.max(header.minZoom, Math.min(header.maxZoom, Math.round(requestedZoom) + 1));
  let window: TileWindow;
  while (true) {
    try { window = tileWindow(bounds, vectorZoom); break; }
    catch (error) {
      if (vectorZoom <= header.minZoom || !(error instanceof Error) || !error.message.includes("too large")) throw error;
      vectorZoom -= 1;
    }
  }
  const projectPoint = (tile: { x: number; y: number }, extent: number, point: Point2D): Point2D => ({
    x: (((tile.x + point.x / extent) * TILE_SIZE - window.westX) / (window.eastX - window.westX) - 0.5) * config.widthMm,
    y: (((tile.y + point.y / extent) * TILE_SIZE - window.northY) / (window.southY - window.northY) - 0.5) * config.heightMm,
  });
  const perTile = await Promise.all(window.tiles.map(async (tile): Promise<{ markings: MarkingFeature[]; waterPolygons: Polygon2D[] }> => {
    const markings: MarkingFeature[] = [];
    const waterPolygons: Polygon2D[] = [];
    const response = await vectorArchive.getZxy(tile.z, tile.x, tile.y, signal);
    if (!response) return { markings, waterPolygons };
    const vectorTile = new VectorTile(new PbfReader(new Uint8Array(response.data)));
    for (const [layerName, layer] of Object.entries(vectorTile.layers)) {
      const lowered = layerName.toLowerCase();
      const isRoad = lowered.includes("road") || lowered.includes("transportation");
      const isWater = lowered === "water" || lowered.includes("waterway");
      if (!isRoad && !isWater) continue;
      for (let featureIndex = 0; featureIndex < layer.length && markings.length < 1800; featureIndex += 1) {
        const feature = layer.feature(featureIndex);
        if (feature.type !== 2 && !(isWater && feature.type === 3)) continue;
        const transportationClass = isRoad ? classifyTransportation(feature.properties as Record<string, unknown>) : undefined;
        if (isRoad && !transportationClass) continue;
        const label = isRoad ? transportationLabel(feature.properties as Record<string, unknown>) : undefined;
        const geometry = feature.loadGeometry();
        if (isWater && feature.type === 3) {
          classifyRings(geometry).forEach((polygon) => {
            const [outer, ...holes] = polygon;
            if (!outer) return;
            waterPolygons.push({ outer: outer.map((point) => projectPoint(tile, feature.extent, point)), holes: holes.map((ring) => ring.map((point) => projectPoint(tile, feature.extent, point))) });
          });
          continue;
        }
        geometry.forEach((line, lineIndex) => {
          const lines = clipVectorTileLine(line, feature.extent);
          lines.forEach((clippedLine, clippedIndex) => {
            if (clippedLine.length < 2 || markings.length >= 1800) return;
            markings.push({ id: `${tile.z}-${tile.x}-${tile.y}-${layerName}-${feature.id ?? featureIndex}-${lineIndex}-${clippedIndex}`, kind: transportationClass === "trail" ? "trail" : isRoad ? "road" : "water", operation: isRoad ? "engrave" : "score", ...(transportationClass ? { transportationClass } : {}), ...(label ? { label } : {}), points: clippedLine.map((point) => ({
              ...projectPoint(tile, feature.extent, point),
            })) });
          });
        });
      }
    }
    return { markings, waterPolygons };
  }));
  const rawMarkings = perTile.flatMap((tile) => tile.markings);
  const transportation = stitchTransportationMarkings(rawMarkings.filter((marking) => marking.kind !== "water"));
  const waterways = cleanWaterwayMarkings(rawMarkings.filter((marking) => marking.kind === "water"), config.minimumFeatureMm);
  const shorelines = dissolveWaterPolygons(perTile.flatMap((tile) => tile.waterPolygons), config.minimumFeatureMm);
  return [...transportation, ...shorelines, ...waterways].slice(0, 1800);
}

function groundWidthM(bounds: GeoBounds): number {
  return Math.abs(bounds.east - bounds.west) * Math.PI / 180 * 6_371_008.8 * Math.cos(((bounds.north + bounds.south) / 2) * Math.PI / 180);
}

export async function loadTerrain(config: ProjectConfigV1, signal?: AbortSignal): Promise<{ source: SourceBundleV1; fallback: boolean }> {
  const bounds = boundsForProject(config);
  // Compiled only into the Playwright build (vite build --mode e2e) so browser
  // generation/export stays deterministic and cannot accidentally depend on an
  // external map service. The mode guard keeps a leaked VITE_E2E env var from
  // defeating the fabrication export policy in a production build.
  if (import.meta.env.VITE_E2E === "1" && (import.meta.env.DEV || import.meta.env.MODE !== "production")) {
    signal?.throwIfAborted();
    const fixture = createSyntheticSource({ ...config, location: { ...config.location, bounds } }, 32);
    return { fallback: false, source: { ...fixture, sourceKind: "real", datasetVersion: "topostack-browser-e2e-v1", vectorStatus: "available" } };
  }
  const zoom = Math.max(0, Math.min(15, Math.round(config.location.zoom)));
  try {
    const window = tileWindow(bounds, zoom);
    const vectorRequested = config.showRoads || config.showTrails || config.showWater;
    const [{ elevation, imagerySources, datasetVersion }, vector] = await Promise.all([
      loadElevation(window, signal),
      vectorRequested
        ? loadVectorMarkings(bounds, zoom, config, signal)
          .then((markings) => ({ markings, status: "available" as const }))
          .catch((error) => {
            if (signal?.aborted) throw error;
            return { markings: [], status: "unavailable" as const };
          })
        : Promise.resolve({ markings: [], status: "not-requested" as const }),
    ]);
    return { fallback: false, source: { schemaVersion: 1, elevation, markings: vector.markings, vectorStatus: vector.status, datasetVersion, sourceKind: "real", bounds, imagerySources, resolutionM: groundWidthM(bounds) / elevation.width, attribution: MAP_DATA_ATTRIBUTION } };
  } catch (error) {
    if (signal?.aborted) throw error;
    const source = createSyntheticSource({ ...config, location: { ...config.location, bounds } });
    return { source: { ...source, vectorStatus: config.showRoads || config.showTrails || config.showWater ? "unavailable" : "not-requested" }, fallback: true };
  }
}

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<PlaceResult[]> {
  if (query.trim().length < 2) return [];
  const response = await fetch(`${apiBase}/v1/geocode?q=${encodeURIComponent(query.trim())}&limit=5`, { signal });
  if (!response.ok) throw new Error("Place search is temporarily unavailable.");
  const value: unknown = await response.json();
  if (!Array.isArray(value)) throw new Error("Place search returned an unexpected response.");
  return value.flatMap((item): PlaceResult[] => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const lat = Number(record.lat);
    const lon = Number(record.lon);
    const label = typeof record.display_name === "string" ? record.display_name : "Unnamed location";
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
    return [{ id: String(record.place_id ?? `${lat},${lon}`), label, lat, lon, type: typeof record.type === "string" ? record.type : undefined }];
  });
}
