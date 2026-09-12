import { expect, test } from "@playwright/test";
import { unzipSync } from "fflate";

test("production generates export-ready real terrain", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Build the landscape." })).toBeVisible();
  await page.getByRole("button", { name: /Generate terrain/ }).click();
  await expect(page.locator(".status-line")).toContainText("Real terrain ready", { timeout: 120_000 });
  await expect(page.getByText("Ready to export")).toBeVisible();
  const button = page.getByRole("button", { name: "Download files" });
  await expect(button).toBeEnabled();
  const downloadReady = page.waitForEvent("download");
  await button.click();
  const download = await downloadReady;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const files = unzipSync(Buffer.concat(chunks));
  expect(Object.keys(files)).toContain("README.txt");
  const master = Object.keys(files).find((name) => name.endsWith("-master.svg"));
  expect(master).toBeTruthy();
  expect(errors).toEqual([]);
  expect(Buffer.from(files[master!]!).toString("utf8")).toContain('data-operation="CUT"');
});
