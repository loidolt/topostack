import { expect, test } from "@playwright/test";

test("generates deterministic real terrain and downloads a fabrication SVG", async ({ page }) => {
  test.setTimeout(90_000);
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.route("**/v1/**", (route) => route.abort("internetdisconnected"));
  await page.route("https://static-res.atomm.com/**", (route) => route.abort("internetdisconnected"));

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Build the landscape." })).toBeVisible();
  await page.getByRole("button", { name: "Expand all" }).click();
  // The bundled real-data preview must never be exportable: fail closed until
  // the user generates fresh terrain.
  await expect(page.getByText("Generate before export")).toBeVisible();
  await expect(page.getByRole("button", { name: "Download SVG" })).toBeDisabled();
  await page.getByRole("radio", { name: /Cut layers/ }).click();
  await expect(page.locator(".layer-heading")).toContainText(/Layer \d+.*of 10/);
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
  const roads = page.getByRole("switch", { name: "Roads" });
  await roads.click();
  await expect(roads).not.toBeChecked();
  await expect(preview).toHaveAttribute("data-road-markings", "0", { timeout: 15_000 });
  await roads.click();
  await expect(roads).toBeChecked();
  await expect.poll(async () => Number(await preview.getAttribute("data-road-markings")), { timeout: 15_000 }).toBeGreaterThan(0);
  const transportationLabels = page.getByRole("switch", { name: "Transportation labels" });
  await expect(transportationLabels).not.toBeChecked();
  await transportationLabels.click();
  await expect(transportationLabels).toBeChecked();
  await expect(page.getByRole("switch", { name: "Assembly guides" })).toBeChecked();
  await page.getByRole("spinbutton", { name: "Width", exact: true }).fill("1200");
  await expect(page.locator(".status-line")).toContainText("updated");
  await expect(page.locator(".preview-readout")).toContainText("1200 × 200 mm");
  await page.getByRole("radio", { name: "Imperial" }).click();
  await expect(page.locator(".preview-readout")).toContainText("47.244 × 7.874 in");
  await expect(page.locator(".layer-heading")).toContainText("ft");
  // Typing while in imperial mode must store millimeters internally:
  // 10 in -> 254 mm (an inverted conversion would show 0.394 mm instead).
  await page.getByRole("spinbutton", { name: "Width", exact: true }).fill("10");
  await expect(page.locator(".preview-readout")).toContainText("10 × 7.874 in");
  await page.getByRole("radio", { name: "Metric" }).click();
  await expect(page.locator(".preview-readout")).toContainText("254 × 200 mm");
  await page.getByRole("spinbutton", { name: "Width", exact: true }).fill("1200");
  await expect(page.locator(".preview-readout")).toContainText("1200 × 200 mm");
  // Text engraving and the elevation label position live beside what they
  // affect in Map details; only the fabrication numbers are behind the panel.
  await page.getByRole("radio", { name: /Stencil/ }).click();
  await expect(page.getByRole("radio", { name: /Stencil/ })).toBeChecked();
  await page.getByRole("spinbutton", { name: "Text size", exact: true }).fill("4.5");
  await expect(page.getByLabel("Text size slider")).toHaveValue("4.5");
  await page.getByRole("spinbutton", { name: "Label X", exact: true }).fill("0");
  await page.getByRole("spinbutton", { name: "Label Y", exact: true }).fill("0");
  await expect(page.getByRole("button", { name: /Fabrication settings/ })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("switch", { name: "Material-saving nests" })).toBeChecked();
  await expect(page.getByRole("spinbutton", { name: "Glue margin", exact: true })).toHaveValue("8");
  await page.getByRole("button", { name: /Generate terrain/ }).click();

  await expect(page.locator(".status-line")).toContainText("Real terrain ready", { timeout: 30_000 });
  await expect(page.getByText("Ready to export")).toBeVisible();
  const downloadButton = page.getByRole("button", { name: "Download SVG" });
  await expect(downloadButton).toBeEnabled();

  const downloadPromise = page.waitForEvent("download");
  await downloadButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("crater-lake-master.svg");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const svg = Buffer.concat(chunks).toString("utf8");
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
});

test("persists the selected color scheme across reloads", async ({ page }) => {
  await page.route("https://static-res.atomm.com/**", (route) => route.abort("internetdisconnected"));
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
  await page.route("https://static-res.atomm.com/**", (route) => route.abort("internetdisconnected"));
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
