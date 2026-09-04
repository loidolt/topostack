import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { FabricationPackageV1 } from "@topostack/core";
import { prepareProjectDownload } from "./native-export";

describe("native export", () => {
  it("packages every project file into one clearly named download", async () => {
    const master = { filename: "mount-rainier-master.svg", blob: new Blob(["<svg />"], { type: "image/svg+xml" }) };
    const output: FabricationPackageV1 = {
      schemaVersion: 1,
      master,
      files: [master, { filename: "README.txt", blob: new Blob(["Build guide"], { type: "text/plain" }) }],
    };

    const download = await prepareProjectDownload(output);
    const files = unzipSync(new Uint8Array(await download.blob.arrayBuffer()));

    expect(download.filename).toBe("mount-rainier-project-files.zip");
    expect(download.fileCount).toBe(2);
    expect(Object.keys(files)).toEqual(["mount-rainier-master.svg", "README.txt"]);
    expect(new TextDecoder().decode(files["README.txt"])).toBe("Build guide");
  });
});
