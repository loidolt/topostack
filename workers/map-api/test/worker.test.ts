import { afterEach, describe, expect, it, vi } from "vitest";
import { env as workerEnv, exports } from "cloudflare:workers";
import { geocodeLimit, isAllowedOrigin, isGeocoderConfigured, normalizeGeoapify, parseRangeHeader, validTile } from "../src/index";

const env = {
  ALLOWED_ORIGINS: "http://localhost:5273,http://127.0.0.1:5273,https://topostack.echofoxtrot.works,https://www.atomm.com",
} satisfies Pick<Env, "ALLOWED_ORIGINS">;

describe("map API validation", () => {
  it("runs the Worker with its generated bindings", async () => {
    const response = await exports.default.fetch("http://example.com/health", {
      headers: { origin: "http://localhost:5273" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ service: "topostack-map-api", status: "ok" });
  });

  it("accepts valid tiles and rejects out-of-range coordinates", () => {
    expect(validTile("11", "321", "702")).toEqual({ z: 11, x: 321, y: 702 });
    expect(validTile("11", "3000", "702")).toBeNull();
    expect(validTile("16", "1", "1")).toBeNull();
  });

  it("allows local, production, and Atomm origins without opening arbitrary origins", () => {
    expect(isAllowedOrigin("http://localhost:5273", env)).toBe(true);
    expect(isAllowedOrigin("https://topostack.echofoxtrot.works", env)).toBe(true);
    expect(isAllowedOrigin("https://runtime.atomm.com", env)).toBe(true);
    expect(isAllowedOrigin("https://example.com", env)).toBe(false);
    expect(isAllowedOrigin("https://runtime.atomm.com.evil.example", env)).toBe(false);
    expect(isAllowedOrigin("https://evil-atomm.com", env)).toBe(false);
  });

  it("accepts any loopback port only on the development Worker", () => {
    const development = { ...env, ENVIRONMENT: "development" };
    const production = { ...env, ENVIRONMENT: "production" };
    // The dev server relocates when its default port is taken, so the port is
    // not knowable ahead of time.
    expect(isAllowedOrigin("http://localhost:5291", development)).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:5291", development)).toBe(true);
    expect(isAllowedOrigin("http://[::1]:5291", development)).toBe(true);
    expect(isAllowedOrigin("http://localhost:5291", production)).toBe(false);
    expect(isAllowedOrigin("http://localhost:5291", env)).toBe(false);
    // Loopback-looking hosts that are not loopback stay out, in every mode.
    expect(isAllowedOrigin("http://localhost.evil.example", development)).toBe(false);
    expect(isAllowedOrigin("https://localhost:5291", development)).toBe(false);
    expect(isAllowedOrigin("not a url", development)).toBe(false);
  });

  it("honors configured origin suffixes and keeps the suffix boundary", () => {
    const configured = { ALLOWED_ORIGINS: "", ALLOWED_ORIGIN_SUFFIXES: ".example.net" };
    expect(isAllowedOrigin("https://tools.example.net", configured)).toBe(true);
    expect(isAllowedOrigin("http://tools.example.net", configured)).toBe(false);
    expect(isAllowedOrigin("https://evil-example.net", configured)).toBe(false);
    expect(isAllowedOrigin("https://runtime.atomm.com", configured)).toBe(false);
    // An empty configuration revokes suffix-based origins entirely.
    expect(isAllowedOrigin("https://runtime.atomm.com", { ALLOWED_ORIGINS: "", ALLOWED_ORIGIN_SUFFIXES: "" })).toBe(false);
    // Suffixes without a leading dot still respect the label boundary.
    expect(isAllowedOrigin("https://runtime.atomm.com", { ALLOWED_ORIGINS: "", ALLOWED_ORIGIN_SUFFIXES: "atomm.com" })).toBe(true);
    expect(isAllowedOrigin("https://evil-atomm.com", { ALLOWED_ORIGINS: "", ALLOWED_ORIGIN_SUFFIXES: "atomm.com" })).toBe(false);
  });

  it("returns a valid CORS preflight only for an allowed origin", async () => {
    const response = await exports.default.fetch("http://example.com/v1/manifest", { method: "OPTIONS", headers: { origin: "https://runtime.atomm.com" } });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://runtime.atomm.com");
    const denied = await exports.default.fetch("http://example.com/v1/manifest", { headers: { origin: "https://evil.example" } });
    expect(denied.status).toBe(403);
    expect(denied.headers.has("access-control-allow-origin")).toBe(false);
  });

  it("does not call geocoding without a deployed provider key", async () => {
    const response = await exports.default.fetch("http://example.com/v1/geocode?q=Rainier", { headers: { origin: "http://localhost:5273" } });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "Geocoder is not configured." });
  });

  it("reports missing required dependencies as not ready", async () => {
    expect(isGeocoderConfigured({ GEOCODER_API_KEY: "replace-with-geoapify-key" })).toBe(false);
    expect(isGeocoderConfigured({ GEOCODER_API_KEY: "configured-key" })).toBe(true);
    const response = await exports.default.fetch("http://example.com/ready", { headers: { origin: "http://localhost:5273" } });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      service: "topostack-map-api",
      status: "not_ready",
      dependencies: { geocoder: { status: "unconfigured" }, vectorData: { status: "missing", key: "osm/current.pmtiles" } },
    });
  });

  it("normalizes and filters managed geocoder responses", () => {
    expect(normalizeGeoapify({ results: [
      { place_id: "abc", formatted: "Mount Rainier, Washington", lat: 46.85, lon: -121.76, result_type: "natural" },
      { formatted: "Broken", lat: "invalid", lon: 1 },
    ] })).toEqual([{ place_id: "abc", display_name: "Mount Rainier, Washington", lat: 46.85, lon: -121.76, type: "natural" }]);
  });

  it("defaults non-numeric geocode limits instead of forwarding NaN", () => {
    expect(geocodeLimit(null)).toBe(5);
    expect(geocodeLimit("abc")).toBe(5);
    expect(geocodeLimit("")).toBe(5);
    expect(geocodeLimit("3")).toBe(3);
    expect(geocodeLimit("3.9")).toBe(3);
    expect(geocodeLimit("0")).toBe(1);
    expect(geocodeLimit("99")).toBe(8);
  });

  it("parses and validates byte ranges", () => {
    expect(parseRangeHeader(null, 100)).toEqual({ kind: "full" });
    expect(parseRangeHeader("bytes=0-9", 100)).toEqual({ kind: "partial", offset: 0, length: 10 });
    expect(parseRangeHeader("bytes=90-", 100)).toEqual({ kind: "partial", offset: 90, length: 10 });
    expect(parseRangeHeader("bytes=-27", 100)).toEqual({ kind: "partial", offset: 73, length: 27 });
    expect(parseRangeHeader("bytes=-500", 100)).toEqual({ kind: "partial", offset: 0, length: 100 });
    expect(parseRangeHeader("bytes=0-999", 100)).toEqual({ kind: "partial", offset: 0, length: 100 });
    expect(parseRangeHeader("bytes=999999999999-", 100)).toEqual({ kind: "unsatisfiable" });
    expect(parseRangeHeader("bytes=0-1,5-6", 100)).toEqual({ kind: "unsatisfiable" });
    expect(parseRangeHeader("bytes=-0", 100)).toEqual({ kind: "unsatisfiable" });
    expect(parseRangeHeader("bytes=abc", 100)).toEqual({ kind: "full" });
    expect(parseRangeHeader("bytes=9-1", 100)).toEqual({ kind: "full" });
    expect(parseRangeHeader("bytes=0-", 0)).toEqual({ kind: "unsatisfiable" });
  });
});

describe("terrain proxy", () => {
  const origin = { origin: "http://localhost:5273" };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects invalid tile coordinates", async () => {
    const response = await exports.default.fetch("http://example.com/v1/terrain/16/0/0.png", { headers: origin });
    expect(response.status).toBe(400);
  });

  it("fetches, labels, and stores an uncached terrain tile under the dataset-versioned key", async () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const upstream = vi.fn(async (input: RequestInfo | URL) => new Response(png.slice(), {
      headers: { "content-type": "image/png", "x-imagery-sources": "mapzen/test-source" },
    }));
    vi.stubGlobal("fetch", upstream);
    const response = await exports.default.fetch("http://example.com/v1/terrain/11/321/702.png", { headers: origin });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-topostack-cache")).toBe("MISS");
    expect(response.headers.get("x-topostack-dataset")).toBe(workerEnv.DATASET_VERSION);
    expect(response.headers.get("x-topostack-imagery-sources")).toBe("mapzen/test-source");
    expect(response.headers.has("accept-ranges")).toBe(false);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(String(upstream.mock.calls[0]?.[0])).toBe(`${workerEnv.TERRAIN_ORIGIN}/11/321/702.png`);
    await vi.waitFor(async () => {
      const stored = await workerEnv.MAP_CACHE.head(`terrain/${workerEnv.DATASET_VERSION}/terrarium/11/321/702.png`);
      expect(stored).not.toBeNull();
      expect(stored?.customMetadata?.dataset).toBe(workerEnv.DATASET_VERSION);
    });
  });

  it("serves cached tiles with their stored dataset label without calling upstream", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await workerEnv.MAP_CACHE.put(`terrain/${workerEnv.DATASET_VERSION}/terrarium/11/321/703.png`, bytes.slice(), {
      httpMetadata: { contentType: "image/png" },
      customMetadata: { dataset: "mapzen-terrarium+protomaps-legacy", imagerySources: "mapzen/stored-source" },
    });
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const response = await exports.default.fetch("http://example.com/v1/terrain/11/321/703.png", { headers: origin });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-topostack-cache")).toBe("HIT");
    expect(response.headers.get("x-topostack-dataset")).toBe("mapzen-terrarium+protomaps-legacy");
    expect(response.headers.get("x-topostack-imagery-sources")).toBe("mapzen/stored-source");
    expect(response.headers.has("accept-ranges")).toBe(false);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe("vector archive", () => {
  const origin = { origin: "http://localhost:5273" };
  const archive = new Uint8Array(256).map((_, index) => index % 251);

  async function seedArchive(): Promise<void> {
    await workerEnv.VECTOR_DATA.put("osm/current.pmtiles", archive.slice());
  }

  it("serves full reads with a short revalidating cache policy", async () => {
    await seedArchive();
    const response = await exports.default.fetch("http://example.com/v1/osm.pmtiles", { headers: origin });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(response.headers.get("cache-control")).not.toContain("immutable");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("etag")).toBeTruthy();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(archive);
  });

  it("revalidates by etag with 304", async () => {
    await seedArchive();
    const first = await exports.default.fetch("http://example.com/v1/osm.pmtiles", { headers: origin });
    const etag = first.headers.get("etag") ?? "";
    await first.body?.cancel();
    const revalidated = await exports.default.fetch("http://example.com/v1/osm.pmtiles", {
      headers: { ...origin, "if-none-match": etag },
    });
    expect(revalidated.status).toBe(304);
    expect(revalidated.headers.get("etag")).toBe(etag);
  });

  it("serves single and suffix ranges with correct content-range headers", async () => {
    await seedArchive();
    const single = await exports.default.fetch("http://example.com/v1/osm.pmtiles", { headers: { ...origin, range: "bytes=0-126" } });
    expect(single.status).toBe(206);
    expect(single.headers.get("content-range")).toBe("bytes 0-126/256");
    expect(single.headers.get("content-length")).toBe("127");
    expect(new Uint8Array(await single.arrayBuffer())).toEqual(archive.slice(0, 127));

    const suffix = await exports.default.fetch("http://example.com/v1/osm.pmtiles", { headers: { ...origin, range: "bytes=-27" } });
    expect(suffix.status).toBe(206);
    expect(suffix.headers.get("content-range")).toBe("bytes 229-255/256");
    expect(suffix.headers.get("content-length")).toBe("27");
    expect(new Uint8Array(await suffix.arrayBuffer())).toEqual(archive.slice(229));
  });

  it("rejects unsatisfiable and multipart ranges with 416 instead of 500", async () => {
    await seedArchive();
    const unsatisfiable = await exports.default.fetch("http://example.com/v1/osm.pmtiles", { headers: { ...origin, range: "bytes=999999999999-" } });
    expect(unsatisfiable.status).toBe(416);
    expect(unsatisfiable.headers.get("content-range")).toBe("bytes */256");

    const multipart = await exports.default.fetch("http://example.com/v1/osm.pmtiles", { headers: { ...origin, range: "bytes=0-1,5-6" } });
    expect(multipart.status).toBe(416);
    expect(multipart.headers.get("content-range")).toBe("bytes */256");

    const malformed = await exports.default.fetch("http://example.com/v1/osm.pmtiles", { headers: { ...origin, range: "bytes=abc" } });
    expect(malformed.status).toBe(200);
    await malformed.body?.cancel();
  });
});

describe("lake bathymetry archive", () => {
  const origin = { origin: "http://localhost:5273" };
  const archive = new Uint8Array(128).map((_, index) => (index * 7) % 251);

  it("serves the archive and its ranges, which is all the PMTiles client asks of it", async () => {
    await workerEnv.VECTOR_DATA.put("lakes/current.pmtiles", archive.slice());

    const full = await exports.default.fetch("http://example.com/v1/lakes.pmtiles", { headers: origin });
    expect(full.status).toBe(200);
    expect(full.headers.get("accept-ranges")).toBe("bytes");
    expect(new Uint8Array(await full.arrayBuffer())).toEqual(archive);

    // The browser never downloads the whole archive - it range-reads the header,
    // then the directory, then the handful of tiles the map window covers.
    const ranged = await exports.default.fetch("http://example.com/v1/lakes.pmtiles", { headers: { ...origin, range: "bytes=0-16" } });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get("content-range")).toBe("bytes 0-16/128");
    expect(new Uint8Array(await ranged.arrayBuffer())).toEqual(archive.slice(0, 17));
  });

  it("reports a missing archive as 404 so lake depth degrades to flat water", async () => {
    await workerEnv.VECTOR_DATA.delete("lakes/current.pmtiles");
    const response = await exports.default.fetch("http://example.com/v1/lakes.pmtiles", { headers: origin });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "Lake bathymetry archive has not been provisioned." });
  });

  it("reports lake data in readiness without making it a requirement", async () => {
    await workerEnv.VECTOR_DATA.delete("lakes/current.pmtiles");
    const response = await exports.default.fetch("http://example.com/ready", { headers: origin });
    expect(await response.json()).toMatchObject({ dependencies: { lakeData: { status: "missing", key: "lakes/current.pmtiles" } } });
  });
});
