import { expect, test } from "@playwright/test";

test("generates deterministic real terrain and downloads a fabrication SVG", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.route("**/v1/**", (route) => route.abort("internetdisconnected"));
  await page.route("https://static-res.atomm.com/**", (route) => route.abort("internetdisconnected"));

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Build the landscape." })).toBeVisible();
  await page.getByRole("button", { name: /Fabrication settings/ }).click();
  await page.getByLabel("Label X").fill("0");
  await page.getByLabel("Label Y").fill("0");
  await page.getByRole("button", { name: /Generate terrain/ }).click();

  await expect(page.locator(".status-line")).toContainText("Real terrain ready", { timeout: 30_000 });
  await expect(page.getByText("Ready to export")).toBeVisible();
  const downloadButton = page.getByRole("button", { name: "Download SVG" });
  await expect(downloadButton).toBeEnabled();

  const downloadPromise = page.waitForEvent("download");
  await downloadButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("mount-rainier-master.svg");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const svg = Buffer.concat(chunks).toString("utf8");
  expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
  expect(svg).toContain('data-operation="CUT"');
  expect(svg).toContain('id="elevation-0"');
  expect(svg).not.toContain("<text");
  expect(svg).toContain("Mount Rainier — master layout");
  expect(browserErrors).toEqual([]);
});
