import { createSyntheticSource, type GeoBounds, type MarkingFeature, type ProjectConfigV1, type SourceAttribution, type SourceBundleV1 } from "@topostack/core";
import { PMTiles } from "pmtiles";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";

export interface PlaceResult { id: string; label: string; lat: number; lon: number; type?: string }

const configuredApiBase = (import.meta.env.VITE_MAP_API_URL as string | undefined)?.replace(/\/$/, "");
const developmentApiBase = import.meta.env.DEV ? "http://localhost:8787" : undefined;
// Standalone deployments serve the app and API from the same Worker. Atomm
// packages still inject an explicit API URL during their build.
const apiBase = configuredApiBase ?? developmentApiBase ?? "";
const vectorArchive = new PMTiles(`${apiBase}/v1/osm.pmtiles`);
const TILE_SIZE = 256;
const MAX_DATA_TILES = 24;
const TERRAIN_ATTRIBUTION: SourceAttribution[] = [
  { name: "Mapzen Terrain Tiles", url: "https://registry.opendata.aws/terrain-tiles/", license: "Composite terrain dataset; source-specific notices follow" },
  { name: "ArcticDEM", url: "https://www.pgc.umn.edu/data/arcticdem/", license: "Created from DigitalGlobe imagery and funded under NSF awards 1043681, 1559691, and 1542736" },
  { name: "Geoscience Australia", url: "https://www.ga.gov.au/", license: "© Commonwealth of Australia (Geoscience Australia) 2017" },
  { name: "Open Data Austria", url: "https://www.data.gv.at/", license: "© offene Daten Österreichs – Digitales Geländemodell (DGM) Österreich" },
  { name: "Government of Canada", url: "https://open.canada.ca/", license: "Contains information licensed under the Open Government Licence – Canada" },
  { name: "EU-DEM", url: "https://land.copernicus.eu/", license: "Produced using Copernicus data and information funded by the European Union" },
  { name: "NOAA ETOPO1", url: "https://www.ncei.noaa.gov/products/etopo-global-relief-model", license: "Terrain data courtesy of NOAA/NCEI" },
  { name: "INEGI", url: "https://www.inegi.org.mx/", license: "Source: INEGI, Continental relief, 2016" },
  { name: "Land Information New Zealand", url: "https://www.linz.govt.nz/", license: "Copyright 2011 Crown copyright © LINZ and the New Zealand Government" },
  { name: "Kartverket", url: "https://www.kartverket.no/", license: "© Kartverket" },
  { name: "UK Environment Agency", url: "https://www.gov.uk/government/organisations/environment-agency", license: "© Environment Agency copyright and/or database right 2015" },
  { name: "U.S. Geological Survey", url: "https://www.usgs.gov/", license: "3DEP, GMTED2010, and SRTM terrain data courtesy of the U.S. Geological Survey" },
  { name: "Protomaps Basemap 20260819", url: "https://protomaps.com", license: "ODbL Produced Work based on OpenStreetMap data" },
  { name: "OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright", license: "ODbL" },
];

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
  const heightPx = widthPx * config.heightMm / config.widthMm;
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

async function loadElevation(window: TileWindow, signal?: AbortSignal): Promise<{ elevation: SourceBundleV1["elevation"]; imagerySources: string[]; datasetVersion: string }> {
  const responses = await Promise.all(window.tiles.map(async (tile) => {
    const response = await fetch(`${apiBase}/v1/terrain/${tile.z}/${tile.x}/${tile.y}.png`, { signal });
    if (!response.ok) throw new Error(`Terrain service returned ${response.status}.`);
    return { tile, response, bitmap: await createImageBitmap(await response.blob()) };
  }));
  const outputWidth = 320;
  const outputHeight = Math.max(64, Math.min(640, Math.round(outputWidth * (window.southY - window.northY) / (window.eastX - window.westX))));
  const canvas = new OffscreenCanvas(outputWidth, outputHeight);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("This browser cannot decode elevation tiles.");
  const scaleX = outputWidth / (window.eastX - window.westX);
  const scaleY = outputHeight / (window.southY - window.northY);
  const imagerySources = new Set<string>();
  const datasetVersions = new Set<string>();
  for (const { tile, response, bitmap } of responses) {
    const datasetVersion = response.headers.get("x-topostack-dataset");
    if (datasetVersion) datasetVersions.add(datasetVersion);
    response.headers.get("x-topostack-imagery-sources")?.split(",").map((value) => value.trim()).filter(Boolean).forEach((value) => imagerySources.add(value));
    context.drawImage(bitmap, (tile.x * TILE_SIZE - window.westX) * scaleX, (tile.y * TILE_SIZE - window.northY) * scaleY, TILE_SIZE * scaleX, TILE_SIZE * scaleY);
    bitmap.close();
  }
  const pixels = context.getImageData(0, 0, outputWidth, outputHeight).data;
  const values = new Float32Array(outputWidth * outputHeight);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < values.length; index += 1) {
    const pixel = index * 4;
    const elevation = (pixels[pixel] ?? 0) * 256 + (pixels[pixel + 1] ?? 0) + (pixels[pixel + 2] ?? 0) / 256 - 32768;
    values[index] = elevation;
    min = Math.min(min, elevation);
    max = Math.max(max, elevation);
  }
  if (datasetVersions.size > 1) throw new Error("Terrain tiles came from inconsistent dataset versions. Try again shortly.");
  return { elevation: { width: outputWidth, height: outputHeight, values, min, max }, imagerySources: [...imagerySources].sort(), datasetVersion: [...datasetVersions][0] ?? "mapzen-terrarium+protomaps-20260819-z11-v1" };
}

async function loadVectorMarkings(bounds: GeoBounds, requestedZoom: number, config: ProjectConfigV1, signal?: AbortSignal): Promise<MarkingFeature[]> {
  const header = await vectorArchive.getHeader();
  signal?.throwIfAborted();
  const window = tileWindow(bounds, Math.max(header.minZoom, Math.min(header.maxZoom, requestedZoom)));
  const markings: MarkingFeature[] = [];
  await Promise.all(window.tiles.map(async (tile) => {
    const response = await vectorArchive.getZxy(tile.z, tile.x, tile.y, signal);
    if (!response) return;
    const vectorTile = new VectorTile(new PbfReader(new Uint8Array(response.data)));
    for (const [layerName, layer] of Object.entries(vectorTile.layers)) {
      const lowered = layerName.toLowerCase();
      const isRoad = lowered.includes("road") || lowered.includes("transportation");
      const isWater = lowered === "water" || lowered.includes("waterway");
      if (!isRoad && !isWater) continue;
      for (let featureIndex = 0; featureIndex < layer.length && markings.length < 1800; featureIndex += 1) {
        const feature = layer.feature(featureIndex);
        if (feature.type !== 2 && !(isWater && feature.type === 3)) continue;
        const featureClass = String(feature.properties.class ?? feature.properties.kind ?? "");
        if (isRoad && ["service", "track", "path"].includes(featureClass) && config.widthMm < 250) continue;
        feature.loadGeometry().forEach((line, lineIndex) => {
          if (line.length < 2 || markings.length >= 1800) return;
          markings.push({ id: `${tile.z}-${tile.x}-${tile.y}-${layerName}-${feature.id ?? featureIndex}-${lineIndex}`, kind: isRoad ? "road" : "water", operation: isRoad ? "engrave" : "score", points: line.map((point) => ({
            x: (((tile.x + point.x / feature.extent) * TILE_SIZE - window.westX) / (window.eastX - window.westX) - 0.5) * config.widthMm,
            y: (((tile.y + point.y / feature.extent) * TILE_SIZE - window.northY) / (window.southY - window.northY) - 0.5) * config.heightMm,
          })) });
        });
      }
    }
  }));
  return markings;
}

function groundWidthM(bounds: GeoBounds): number {
  return Math.abs(bounds.east - bounds.west) * Math.PI / 180 * 6_371_008.8 * Math.cos(((bounds.north + bounds.south) / 2) * Math.PI / 180);
}

export async function loadTerrain(config: ProjectConfigV1, signal?: AbortSignal): Promise<{ source: SourceBundleV1; fallback: boolean }> {
  const bounds = boundsForProject(config);
  // Compiled only into the Playwright build so browser generation/export stays
  // deterministic and cannot accidentally depend on an external map service.
  if (import.meta.env.VITE_E2E === "1") {
    signal?.throwIfAborted();
    const fixture = createSyntheticSource({ ...config, location: { ...config.location, bounds } }, 32);
    return { fallback: false, source: { ...fixture, sourceKind: "real", datasetVersion: "topostack-browser-e2e-v1", vectorStatus: "available" } };
  }
  const zoom = Math.max(0, Math.min(15, Math.round(config.location.zoom)));
  try {
    const window = tileWindow(bounds, zoom);
    const vectorRequested = config.showRoads || config.showWater;
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
    return { fallback: false, source: { schemaVersion: 1, elevation, markings: vector.markings, vectorStatus: vector.status, datasetVersion, sourceKind: "real", bounds, imagerySources, resolutionM: groundWidthM(bounds) / elevation.width, attribution: TERRAIN_ATTRIBUTION } };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { source: createSyntheticSource({ ...config, location: { ...config.location, bounds } }), fallback: true };
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
