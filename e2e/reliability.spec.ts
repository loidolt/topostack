import { expect, test } from "@playwright/test";
import { DEFAULT_PROJECT } from "../packages/core/src/types";

test("falls back to cut layers when WebGL cannot initialize", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://static-res.makextool.com/**", (route) => route.abort());
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
      if (String(args[0]).includes("webgl")) return null;
      return original.apply(this, args);
    } as typeof original;
  });
  await page.goto("/");
  await expect(page.getByRole("radio", { name: /Cut layers/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator('svg[aria-label^="Cut preview for layer"]')).toBeVisible();
  await expect(page.locator(".status-line")).toContainText("3D is unavailable");
  expect(errors).toEqual([]);
});

for (const cropShape of ["rectangle", "circle"] as const) {
test(`keeps saved ${cropShape} bounds aligned after opening and resizing Map`, async ({ page }) => {
  await page.route("https://static-res.makextool.com/**", (route) => route.abort());
  await page.route("https://tiles.openfreemap.org/styles/**", (route) => route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
  await page.goto("/");
  const bounds = { west: -122.3, east: -122.0, north: 43.05, south: 42.85 };
  const project = { ...DEFAULT_PROJECT, cropShape, location: { ...DEFAULT_PROJECT.location, bounds }, markers: [
    { id: "north-west", symbol: "circle", lat: bounds.north, lon: bounds.west },
    { id: "south-east", symbol: "circle", lat: bounds.south, lon: bounds.east },
  ] };
  await page.locator('input[type="file"]').setInputFiles({ name: "selection.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await page.getByRole("button", { name: /Generate terrain/ }).click();
  await expect(page.getByText("Ready to export")).toBeVisible();
  await page.getByRole("radio", { name: "Map", exact: true }).click();
  const guide = page.locator(".crop-guide");
  const markers = page.locator(".topostack-map-marker");
  await expect(markers).toHaveCount(2);
  async function expectAligned(): Promise<void> {
    await expect.poll(async () => {
      const crop = await guide.boundingBox();
      const first = await markers.nth(0).boundingBox();
      const last = await markers.nth(1).boundingBox();
      if (!crop || !first || !last) return Infinity;
      return Math.max(Math.abs(first.x + first.width / 2 - crop.x), Math.abs(first.y + first.height / 2 - crop.y), Math.abs(last.x + last.width / 2 - crop.x - crop.width), Math.abs(last.y + last.height / 2 - crop.y - crop.height));
    }).toBeLessThan(3);
  }
  await expectAligned();
  if (cropShape === "circle") {
    const frame = await guide.boundingBox();
    const outline = await page.locator(".circle-outline").boundingBox();
    expect(outline!.width / frame!.width).toBeCloseTo(Math.min(project.widthMm, project.heightMm) / project.widthMm, 2);
    expect(outline!.height / frame!.height).toBeCloseTo(Math.min(project.widthMm, project.heightMm) / project.heightMm, 2);
  }
  await page.setViewportSize({ width: 900, height: 700 });
  await expectAligned();
  await expect(page.getByText("Ready to export")).toBeVisible();
  await page.getByRole("radio", { name: /Cut layers/ }).click();
  await page.getByRole("radio", { name: "Map", exact: true }).click();
  await expect(markers).toHaveCount(2);
  await expectAligned();
  await expect(page.getByText("Ready to export")).toBeVisible();
});
}
