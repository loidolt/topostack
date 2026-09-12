import { afterEach, describe, expect, it, vi } from "vitest";
import { createArchive, NETWORK_TIMEOUT_MS } from "./archive";

function archiveBytes(directory = false): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(132);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("PMTiles")); bytes[7] = 3;
  view.setUint32(8, 127, true); view.setUint32(16, 5, true);
  view.setUint32(40, 132, true); view.setUint32(56, 137, true);
  bytes[97] = 1; bytes[98] = 1; bytes[99] = 1;
  bytes.set([1, 0, directory ? 0 : 1, directory ? 5 : 3, 1], 127);
  return bytes;
}

function response(bytes = archiveBytes()): Response {
  return new Response(bytes, { status: 206, headers: { etag: '"fixture"' } });
}

function stalled(signal: AbortSignal): Promise<Response> {
  return new Promise((_, reject) => {
    signal.throwIfAborted();
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("archive request lifecycle", () => {
  it("recovers on the next generation after a transient header failure", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })).mockImplementation(async () => response());
    vi.stubGlobal("fetch", fetchMock);
    await expect(createArchive("https://example.test/map.pmtiles").getHeader()).rejects.toThrow("503");
    await expect(createArchive("https://example.test/map.pmtiles").getHeader()).resolves.toMatchObject({ specVersion: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["header", "directory", "tile"])("cancels during the %s request", async (phase) => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      if (phase !== "header" && new Headers(init.headers).get("range")?.startsWith("bytes=0-")) return response(archiveBytes(phase === "directory"));
      return stalled(init.signal!);
    });
    vi.stubGlobal("fetch", fetchMock);
    const pending = createArchive("https://example.test/map.pmtiles", controller.signal).getZxy(0, 0, 0);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(phase === "header" ? 1 : 2));
    controller.abort();
    await rejected;
  });

  it("bounds the header request even without user cancellation", async () => {
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => stalled(init.signal!)));
    const pending = createArchive("https://example.test/map.pmtiles").getHeader();
    const rejected = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
    expect(timeout).toHaveBeenCalledWith(NETWORK_TIMEOUT_MS);
    deadline.abort(new DOMException("Timed out", "TimeoutError"));
    await rejected;
  });

  it("cancels a stalled response body as well as the initial response", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => new Response(new ReadableStream({
      start(stream) { init.signal!.addEventListener("abort", () => stream.error(init.signal!.reason), { once: true }); },
    }), { status: 206 })));
    const pending = createArchive("https://example.test/map.pmtiles", controller.signal).getHeader();
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    controller.abort();
    await rejected;
  });
});
