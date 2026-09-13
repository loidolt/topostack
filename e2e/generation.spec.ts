import { expect, test } from "@playwright/test";
import { unzipSync } from "fflate";

test("generates deterministic real terrain and downloads the complete fabrication package", async ({ page }) => {
  test.setTimeout(180_000);
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.route("**/v1/**", (route) => route.abort("internetdisconnected"));
  await page.route("https://static-res.makextool.com/**", (route) => route.abort("internetdisconnected"));

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Build the landscape." })).toBeVisible();
  await page.getByRole("button", { name: "Expand all" }).click();
  // The bundled real-data preview must never be exportable: fail closed until
  // the user generates fresh terrain.
  await expect(page.getByText("Generate before export")).toBeVisible();
  await expect(page.getByRole("button", { name: "Download files" })).toBeDisabled();
  await page.getByRole("radio", { name: /Cut layers/ }).click();
  await expect(page.locator(".layer-heading")).toContainText(/Layer \d+.*of 13/);
  await expect(page.locator('[data-marking-kind="road"]')).not.toHaveCount(0);
  await page.getByRole("radio", { name: /3D stack/ }).click();
  const preview = page.locator(".preview-stage");
  const mapDetails = [
    ["Roads", "data-road-markings"],
    ["Trails", "data-trail-markings"],
    ["Water outlines", "data-water-markings"],
    ["Assembly guides", "data-alignment-markings"],
    ["Elevation labels", "data-elevation-markings"],
    ["North arrow", "data-north-markings"],
    ["Scale bar", "data-scale-markings"],
  ] as const;
  // Component tests cover every switch transition. Keep the browser test focused
  // on rendered output plus one representative live geometry refresh.
  for (const [label, attribute] of mapDetails) {
    await expect(page.getByRole("switch", { name: label })).toBeChecked();
    await expect.poll(async () => Number(await preview.getAttribute(attribute)), { timeout: 15_000 }).toBeGreaterThan(0);
  }
  await page.getByRole("spinbutton", { name: "Width", exact: true }).fill("1200");
  await expect(page.locator(".status-line")).toContainText("updated", { timeout: 30_000 });
  await expect(page.locator(".preview-readout")).toContainText("1200 × 200 mm");
  await expect(page.getByRole("button", { name: /Fabrication settings/ })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("switch", { name: "Material-saving nests" })).toBeChecked();
  await expect(page.getByRole("spinbutton", { name: "Glue margin", exact: true })).toHaveValue("8");
  await page.getByRole("button", { name: /Generate terrain/ }).click();

  await expect(page.locator(".status-line")).toContainText("Real terrain ready", { timeout: 30_000 });
  await expect(page.getByText("Ready to export")).toBeVisible();
  const downloadButton = page.getByRole("button", { name: "Download files" });
  await expect(downloadButton).toBeEnabled();

  const downloadPromise = page.waitForEvent("download");
  await downloadButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("crater-lake-project-files.zip");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const files = unzipSync(Buffer.concat(chunks));
  expect(Object.keys(files)).toContain("README.txt");
  const svg = Buffer.from(files["crater-lake-master.svg"]).toString("utf8");
  expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
  expect(svg).toContain('data-operation="CUT"');
  // Layer count is derived, and this 1200 mm cut resolves into thin bands, so
  // the base layer's face may be too narrow for its label. Assert the engraved
  // elevation labels exist rather than pinning one layer's.
  expect(svg).toMatch(/id="elevation-\d+"/);
  expect(svg).toContain('id="alignment-layer-01-to-02-');
  expect(svg).toContain("data-layers=");
  expect(svg).not.toContain("<text");
  expect(svg).toContain("Crater Lake — master layout");
  expect(browserErrors).toEqual([]);
  await expect(page.locator(".export-feedback")).toContainText("Download ready");
});

test("persists the selected color scheme across reloads", async ({ page }) => {
  await page.route("https://static-res.makextool.com/**", (route) => route.abort("internetdisconnected"));
  await page.goto("/");
  await page.getByRole("button", { name: "Colour scheme: System" }).click();
  await page.getByRole("button", { name: "Colour scheme: Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Colour scheme: Dark" })).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Colour scheme: Dark" })).toBeVisible();
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#161814");
});

test("location dialog traps focus and restores it on Escape", async ({ page }) => {
  await page.route("https://static-res.makextool.com/**", (route) => route.abort("internetdisconnected"));
  await page.goto("/");
  const trigger = page.locator(".location-card");
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Choose anywhere" });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel("Search places")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("compact layouts keep the preview and controls reachable", async ({ page }) => {
  await page.route("https://static-res.makextool.com/**", (route) => route.abort("internetdisconnected"));
  await page.setViewportSize({ width: 720, height: 900 });
  await page.goto("/");

  await expect(page.locator(".project-name > span")).toHaveText("Project name");
  await expect(page.locator(".terrain-contextbar").getByRole("radiogroup", { name: "Output type" })).toBeVisible();

  const previewBox = await page.locator(".preview-panel").boundingBox();
  const controlsBox = await page.locator(".config-panel").boundingBox();
  expect(previewBox).not.toBeNull();
  expect(controlsBox).not.toBeNull();
  expect(previewBox!.height).toBeGreaterThan(400);
  expect(controlsBox!.y).toBeGreaterThanOrEqual(previewBox!.y + previewBox!.height);

  await page.setViewportSize({ width: 320, height: 700 });
  const topbarBox = await page.locator(".topbar").boundingBox();
  expect(topbarBox).not.toBeNull();
  expect(topbarBox!.height).toBeLessThanOrEqual(70);
  await expect(page.getByRole("radiogroup", { name: "Output type" })).toBeVisible();

  await page.getByRole("button", { name: "Expand all" }).click();
  const widthField = page.getByRole("spinbutton", { name: "Width", exact: true });
  await widthField.scrollIntoViewIfNeeded();

  // Firefox may report a 44px CSS target as 43.999996px in layout coordinates.
  const decrementBox = await page.getByRole("button", { name: "Decrease Width" }).boundingBox();
  const incrementBox = await page.getByRole("button", { name: "Increase Width" }).boundingBox();
  expect(decrementBox).not.toBeNull();
  expect(incrementBox).not.toBeNull();
  expect(decrementBox!.width).toBeGreaterThanOrEqual(44 - 0.01);
  expect(incrementBox!.width).toBeGreaterThanOrEqual(44 - 0.01);

  const numberInput = page.locator(".number-input").filter({ has: widthField });
  const numberFieldBox = await numberInput.locator(".ldt-number-field").boundingBox();
  const unitBox = await numberInput.locator("em").boundingBox();
  expect(numberFieldBox).not.toBeNull();
  expect(unitBox).not.toBeNull();
  expect(numberFieldBox!.x + numberFieldBox!.width).toBeLessThanOrEqual(unitBox!.x + 0.5);

  const roadsBox = await page.getByRole("switch", { name: "Roads" }).boundingBox();
  const presetBox = await page.getByRole("button", { name: "Grand Canyon", exact: true }).boundingBox();
  expect(roadsBox!.height).toBeGreaterThanOrEqual(44 - 0.01);
  expect(presetBox!.height).toBeGreaterThanOrEqual(44 - 0.01);

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
