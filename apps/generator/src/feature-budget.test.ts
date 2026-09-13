import { describe, expect, it } from "vitest";
import { createFeatureBudget, MAX_SOURCE_POINTS, MAX_SOURCE_RINGS, yieldForCancellation } from "./feature-budget";

describe("source complexity limits", () => {
  it("bounds accumulated points across tiles and rings before projection", () => {
    const consume = createFeatureBudget();
    consume([Array.from({ length: MAX_SOURCE_POINTS }, () => ({ x: 0, y: 0 }))]);
    expect(() => consume([[{ x: 1, y: 1 }]])).toThrow(/complexity limit/);
    const polygons = createFeatureBudget();
    expect(() => polygons(Array.from({ length: MAX_SOURCE_RINGS + 1 }, () => [{ x: 0, y: 0 }]), true)).toThrow(/complexity limit/);
  });

  it("lets user cancellation interrupt source processing between batches", async () => {
    const controller = new AbortController();
    const pending = yieldForCancellation(controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
