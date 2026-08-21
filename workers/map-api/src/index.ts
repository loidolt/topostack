const MAX_TERRAIN_BYTES = 2_000_000;
const MAX_GEOCODER_BYTES = 256_000;
const TERRAIN_CACHE_SECONDS = 60 * 60 * 24 * 30;
// The vector archive key is overwritten in place on dataset updates, so client
// and edge caching must stay short and revalidate by etag; a long `immutable`
// TTL would let PMTiles readers mix byte ranges from different archive
// generations for the full cache lifetime.
const VECTOR_CACHE_SECONDS = 60 * 60;
const GEOCODE_CACHE_SECONDS = 60 * 60 * 24;
const VECTOR_ARCHIVE_KEY = "osm/current.pmtiles";
const DEFAULT_ALLOWED_ORIGIN_SUFFIXES = ".atomm.com";

async function readBounded(body: ReadableStream<Uint8Array> | null, maximumBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) throw new Error("UPSTREAM_BODY_TOO_LARGE");
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

function json(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value), { ...init, headers });
}

interface OriginPolicyEnv {
  ALLOWED_ORIGINS: string;
  // Comma-separated host suffixes allowed over HTTPS (default ".atomm.com").
  // Set to an empty string to disable suffix-based origins entirely.
  ALLOWED_ORIGIN_SUFFIXES?: string;
  ENVIRONMENT?: string;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// The local dev server moves to another port whenever its default is taken, so
// pinning exact loopback origins would break `npm run dev` at the first
// collision. Only the development Worker accepts a floating port this way;
// staging and production keep the exact ALLOWED_ORIGINS list.
function isDevelopmentLoopbackOrigin(origin: string, env: OriginPolicyEnv): boolean {
  if (env.ENVIRONMENT !== "development") return false;
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function isAllowedOrigin(origin: string | null, env: OriginPolicyEnv): boolean {
  if (!origin) return true;
  if (env.ALLOWED_ORIGINS.split(",").map((value) => value.trim()).includes(origin)) return true;
  if (isDevelopmentLoopbackOrigin(origin, env)) return true;
  if (!origin.startsWith("https://")) return false;
  const suffixes = (env.ALLOWED_ORIGIN_SUFFIXES ?? DEFAULT_ALLOWED_ORIGIN_SUFFIXES)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    // A leading dot keeps the label boundary: ".atomm.com" matches
    // https://runtime.atomm.com but not https://evil-atomm.com.
    .map((suffix) => (suffix.startsWith(".") ? suffix : `.${suffix}`));
  return suffixes.some((suffix) => origin.endsWith(suffix));
}

function corsHeaders(request: Request, env: Env): Headers {
  const origin = request.headers.get("origin");
  const headers = new Headers({
    "access-control-allow-methods": "GET,HEAD,OPTIONS",
    "access-control-allow-headers": "range,content-type",
    "access-control-expose-headers": "content-length,content-range,etag,x-topostack-dataset,x-topostack-cache,x-topostack-imagery-sources",
    "access-control-max-age": "86400",
    "vary": "Origin",
  });
  if (origin && isAllowedOrigin(origin, env)) headers.set("access-control-allow-origin", origin);
  return headers;
}

function withCors(response: Response, request: Request, env: Env): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of corsHeaders(request, env)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function clientKey(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "anonymous";
}

function validTile(zText: string, xText: string, yText: string): { z: number; x: number; y: number } | null {
  const z = Number(zText);
  const x = Number(xText);
  const y = Number(yText);
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 15) return null;
  const limit = 2 ** z;
  if (x < 0 || y < 0 || x >= limit || y >= limit) return null;
  return { z, x, y };
}

function isGeocoderConfigured(env: Pick<Env, "GEOCODER_API_KEY">): boolean {
  return Boolean(env.GEOCODER_API_KEY && env.GEOCODER_API_KEY !== "replace-with-geoapify-key");
}

async function readinessResponse(env: Env): Promise<Response> {
  const vectorArchive = await env.VECTOR_DATA.head(VECTOR_ARCHIVE_KEY);
  const geocoderConfigured = isGeocoderConfigured(env);
  const ready = Boolean(vectorArchive && geocoderConfigured);
  return json({
    service: "topostack-map-api",
    status: ready ? "ready" : "not_ready",
    environment: env.ENVIRONMENT,
    dependencies: {
      terrain: { status: "configured" },
      geocoder: { status: geocoderConfigured ? "configured" : "unconfigured" },
      vectorData: {
        status: vectorArchive ? "available" : "missing",
        key: VECTOR_ARCHIVE_KEY,
        ...(vectorArchive ? { bytes: vectorArchive.size, etag: vectorArchive.httpEtag } : {}),
      },
    },
  }, { status: ready ? 200 : 503, headers: { "cache-control": "no-store" } });
}

type ParsedRange = { kind: "full" } | { kind: "partial"; offset: number; length: number } | { kind: "unsatisfiable" };

// Single-range parsing only. Multipart range requests (`bytes=0-1,5-6`) are
// rejected with 416 rather than answered with a multipart/byteranges body.
// Malformed Range headers are ignored per RFC 9110 and answered with 200.
function parseRangeHeader(header: string | null, size: number): ParsedRange {
  if (header === null) return { kind: "full" };
  if (header.includes(",")) return { kind: "unsatisfiable" };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return { kind: "full" };
  if (size === 0) return { kind: "unsatisfiable" };
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (suffix === 0) return { kind: "unsatisfiable" };
    const length = Math.min(suffix, size);
    return { kind: "partial", offset: size - length, length };
  }
  const start = Number(match[1]);
  if (start >= size) return { kind: "unsatisfiable" };
  if (match[2] === "") return { kind: "partial", offset: start, length: size - start };
  const end = Number(match[2]);
  if (end < start) return { kind: "full" };
  return { kind: "partial", offset: start, length: Math.min(end, size - 1) - start + 1 };
}

function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  if (ifNoneMatch.trim() === "*") return true;
  const normalize = (value: string) => value.trim().replace(/^W\//, "");
  return ifNoneMatch.split(",").some((candidate) => normalize(candidate) === normalize(etag));
}

function terrainCachedResponse(object: R2ObjectBody, dataset: string): Response {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("x-topostack-cache", "HIT");
  headers.set("x-topostack-dataset", dataset);
  if (object.customMetadata?.imagerySources) headers.set("x-topostack-imagery-sources", object.customMetadata.imagerySources);
  // Terrain keys embed the dataset version, so their content is stable and may
  // cache long. Range requests are not honored here, so do not advertise them.
  headers.set("cache-control", `public, max-age=${TERRAIN_CACHE_SECONDS}, immutable`);
  return new Response(object.body, { headers });
}

async function terrainResponse(request: Request, env: Env, ctx: ExecutionContext, tile: { z: number; x: number; y: number }): Promise<Response> {
  const key = `terrain/${env.DATASET_VERSION}/terrarium/${tile.z}/${tile.x}/${tile.y}.png`;
  const cached = await env.MAP_CACHE.get(key);
  if (cached) return terrainCachedResponse(cached, cached.customMetadata?.dataset ?? env.DATASET_VERSION);

  const upstream = await fetch(`${env.TERRAIN_ORIGIN}/${tile.z}/${tile.x}/${tile.y}.png`, {
    headers: { "user-agent": "TopoStack/0.1 (terrain fabrication generator)" },
  });
  if (!upstream.ok || !upstream.body) return json({ error: "Terrain tile unavailable", status: upstream.status }, { status: 502 });
  const contentLength = Number(upstream.headers.get("content-length") ?? 0);
  const contentType = upstream.headers.get("content-type") ?? "";
  if ((contentLength > 0 && contentLength > MAX_TERRAIN_BYTES) || !contentType.includes("image/png")) {
    return json({ error: "Terrain origin returned an invalid tile" }, { status: 502 });
  }

  const imagerySources = upstream.headers.get("x-imagery-sources") ?? "";
  let body: Uint8Array<ArrayBuffer>;
  try { body = await readBounded(upstream.body, MAX_TERRAIN_BYTES); }
  catch { return json({ error: "Terrain origin returned an oversized tile" }, { status: 502 }); }
  ctx.waitUntil(env.MAP_CACHE.put(key, body, {
    httpMetadata: { contentType: "image/png", cacheControl: `public, max-age=${TERRAIN_CACHE_SECONDS}` },
    customMetadata: { dataset: env.DATASET_VERSION, cachedAt: new Date().toISOString(), imagerySources: imagerySources.slice(0, 1900) },
  }));
  return new Response(body, {
    headers: {
      "content-type": "image/png",
      "content-length": String(body.byteLength),
      "cache-control": `public, max-age=${TERRAIN_CACHE_SECONDS}, immutable`,
      "x-topostack-cache": "MISS",
      "x-topostack-dataset": env.DATASET_VERSION,
      ...(imagerySources ? { "x-topostack-imagery-sources": imagerySources } : {}),
    },
  });
}

interface GeoapifyResult { lat?: unknown; lon?: unknown; formatted?: unknown; place_id?: unknown; result_type?: unknown }

function normalizeGeoapify(payload: unknown): Array<{ place_id: string; display_name: string; lat: number; lon: number; type?: string }> {
  const results = payload && typeof payload === "object" && Array.isArray((payload as { results?: unknown }).results) ? (payload as { results: GeoapifyResult[] }).results : [];
  return results.flatMap((item, index) => {
    const lat = Number(item.lat);
    const lon = Number(item.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || typeof item.formatted !== "string") return [];
    return [{ place_id: String(item.place_id ?? `${lat},${lon},${index}`), display_name: item.formatted, lat, lon, ...(typeof item.result_type === "string" ? { type: item.result_type } : {}) }];
  });
}

function geocodeLimit(value: string | null): number {
  if (value === null || value.trim() === "") return 5;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(8, Math.trunc(parsed))) : 5;
}

async function geocodeResponse(request: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 160);
  const limit = geocodeLimit(url.searchParams.get("limit"));
  if (query.length < 2) return json({ error: "Query must contain at least two characters." }, { status: 400 });
  const keyHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${query.toLowerCase()}|${limit}`));
  const key = `geocode/${Array.from(new Uint8Array(keyHash)).map((byte) => byte.toString(16).padStart(2, "0")).join("")}.json`;
  const cached = await env.MAP_CACHE.get(key);
  if (cached) {
    const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${GEOCODE_CACHE_SECONDS}`, "x-topostack-cache": "HIT" });
    return new Response(cached.body, { headers });
  }

  if (!env.GEOCODER_API_KEY || env.GEOCODER_API_KEY === "replace-with-geoapify-key") return json({ error: "Geocoder is not configured." }, { status: 503 });
  const { success } = await env.GEOCODE_LIMITER.limit({ key: `${clientKey(request)}:geocode` });
  if (!success) return json({ error: "Place-search rate limit exceeded. Try again shortly." }, { status: 429, headers: { "retry-after": "60" } });
  const upstreamUrl = new URL("/v1/geocode/search", env.GEOCODER_ORIGIN);
  upstreamUrl.searchParams.set("text", query);
  upstreamUrl.searchParams.set("limit", String(limit));
  upstreamUrl.searchParams.set("format", "json");
  upstreamUrl.searchParams.set("apiKey", env.GEOCODER_API_KEY);
  const upstream = await fetch(upstreamUrl, { headers: { "accept": "application/json" } });
  if (!upstream.ok) return json({ error: "Geocoder unavailable", status: upstream.status }, { status: 502 });
  const contentLength = Number(upstream.headers.get("content-length") ?? 0);
  if (contentLength > MAX_GEOCODER_BYTES) return json({ error: "Geocoder response too large" }, { status: 502 });
  let body: Uint8Array;
  try { body = await readBounded(upstream.body, MAX_GEOCODER_BYTES); }
  catch { return json({ error: "Geocoder response too large" }, { status: 502 }); }
  let payload: unknown;
  try { payload = JSON.parse(new TextDecoder().decode(body)); } catch { return json({ error: "Geocoder returned invalid JSON" }, { status: 502 }); }
  const normalized = normalizeGeoapify(payload);
  const normalizedBody = JSON.stringify(normalized);
  ctx.waitUntil(env.MAP_CACHE.put(key, normalizedBody, { httpMetadata: { contentType: "application/json", cacheControl: `public, max-age=${GEOCODE_CACHE_SECONDS}` } }));
  return new Response(normalizedBody, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${GEOCODE_CACHE_SECONDS}`, "x-topostack-cache": "MISS" } });
}

async function pmtilesResponse(request: Request, env: Env): Promise<Response> {
  const head = await env.VECTOR_DATA.head(VECTOR_ARCHIVE_KEY);
  if (!head) return json({ error: "OSM archive has not been provisioned." }, { status: 404 });
  const headers = new Headers({
    "etag": head.httpEtag,
    "accept-ranges": "bytes",
    "content-type": "application/vnd.pmtiles",
    "cache-control": `public, max-age=${VECTOR_CACHE_SECONDS}`,
    "x-topostack-cache": "HIT",
    "x-topostack-dataset": env.DATASET_VERSION,
  });
  if (etagMatches(request.headers.get("if-none-match"), head.httpEtag)) return new Response(null, { status: 304, headers });
  if (request.method === "HEAD") {
    headers.set("content-length", String(head.size));
    return new Response(null, { headers });
  }
  const range = parseRangeHeader(request.headers.get("range"), head.size);
  if (range.kind === "unsatisfiable") {
    return json({ error: "Requested range is not satisfiable." }, { status: 416, headers: { "content-range": `bytes */${head.size}` } });
  }
  const object = range.kind === "partial"
    ? await env.VECTOR_DATA.get(VECTOR_ARCHIVE_KEY, { range: { offset: range.offset, length: range.length } })
    : await env.VECTOR_DATA.get(VECTOR_ARCHIVE_KEY);
  if (!object) return json({ error: "OSM archive has not been provisioned." }, { status: 404 });
  headers.set("etag", object.httpEtag);
  if (range.kind === "partial") {
    headers.set("content-range", `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}`);
    headers.set("content-length", String(range.length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("content-length", String(head.size));
  return new Response(object.body, { status: 200, headers });
}

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  if (!isAllowedOrigin(request.headers.get("origin"), env)) return json({ error: "Origin is not allowed." }, { status: 403 });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  if (!(["GET", "HEAD"] as string[]).includes(request.method)) return json({ error: "Method not allowed." }, { status: 405, headers: { allow: "GET,HEAD,OPTIONS" } });

  const { success } = await env.REQUEST_LIMITER.limit({ key: `${clientKey(request)}:${url.pathname.split("/")[2] ?? "root"}` });
  if (!success) return json({ error: "Rate limit exceeded. Try again shortly." }, { status: 429, headers: { "retry-after": "60" } });

  if (url.pathname === "/" || url.pathname === "/health") return json({ service: "topostack-map-api", status: "ok", environment: env.ENVIRONMENT });
  if (url.pathname === "/ready") return readinessResponse(env);
  if (url.pathname === "/v1/manifest") return json({
    schemaVersion: 1,
    datasetVersion: env.DATASET_VERSION,
    coverage: { projection: "Web Mercator", minLatitude: -85.0511, maxLatitude: 85.0511, landOnly: true, vectorMaxZoom: 11 },
    sources: [
      { name: "Mapzen Terrain Tiles", url: "https://registry.opendata.aws/terrain-tiles/", attribution: "See Mapzen source attribution" },
      { name: "Protomaps Basemap 20260819", url: "https://build.protomaps.com/20260819.pmtiles", version: "4.15.2", license: "ODbL Produced Work" },
      { name: "OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright", license: "ODbL" },
    ],
  }, { headers: { "cache-control": "public, max-age=3600" } });
  if (url.pathname === "/v1/geocode") return geocodeResponse(request, env, ctx, url);
  if (url.pathname === "/v1/osm.pmtiles") return pmtilesResponse(request, env);
  const terrainMatch = url.pathname.match(/^\/v1\/terrain\/(\d+)\/(\d+)\/(\d+)\.png$/);
  if (terrainMatch) {
    const tile = validTile(terrainMatch[1] ?? "", terrainMatch[2] ?? "", terrainMatch[3] ?? "");
    if (!tile) return json({ error: "Invalid terrain tile coordinates." }, { status: 400 });
    return terrainResponse(request, env, ctx, tile);
  }
  return json({ error: "Not found." }, { status: 404 });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      console.log(JSON.stringify({ message: "request", method: request.method, path: url.pathname, environment: env.ENVIRONMENT }));
      return withCors(await route(request, env, ctx), request, env);
    } catch (error) {
      console.error(JSON.stringify({ message: "request_failed", path: url.pathname, error: error instanceof Error ? error.message : String(error) }));
      return withCors(json({ error: "Internal map service error." }, { status: 500 }), request, env);
    }
  },
} satisfies ExportedHandler<Env>;

export { geocodeLimit, isAllowedOrigin, isGeocoderConfigured, normalizeGeoapify, parseRangeHeader, validTile };
