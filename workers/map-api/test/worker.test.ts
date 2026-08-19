import { describe, expect, it } from "vitest";
import { exports } from "cloudflare:workers";
import { isAllowedOrigin, normalizeGeoapify, validTile } from "../src/index";

const env = {
  ALLOWED_ORIGINS: "http://localhost:5173,http://127.0.0.1:5173,https://topostack.loidolt.space,https://www.atomm.com",
} satisfies Pick<Env, "ALLOWED_ORIGINS">;

describe("map API validation", () => {
  it("runs the Worker with its generated bindings", async () => {
    const response = await exports.default.fetch("http://example.com/health", {
      headers: { origin: "http://localhost:5173" },
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
    expect(isAllowedOrigin("http://localhost:5173", env)).toBe(true);
    expect(isAllowedOrigin("https://topostack.loidolt.space", env)).toBe(true);
    expect(isAllowedOrigin("https://runtime.atomm.com", env)).toBe(true);
    expect(isAllowedOrigin("https://example.com", env)).toBe(false);
    expect(isAllowedOrigin("https://runtime.atomm.com.evil.example", env)).toBe(false);
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
    const response = await exports.default.fetch("http://example.com/v1/geocode?q=Rainier", { headers: { origin: "http://localhost:5173" } });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "Geocoder is not configured." });
  });

  it("normalizes and filters managed geocoder responses", () => {
    expect(normalizeGeoapify({ results: [
      { place_id: "abc", formatted: "Mount Rainier, Washington", lat: 46.85, lon: -121.76, result_type: "natural" },
      { formatted: "Broken", lat: "invalid", lon: 1 },
    ] })).toEqual([{ place_id: "abc", display_name: "Mount Rainier, Washington", lat: 46.85, lon: -121.76, type: "natural" }]);
  });
});
