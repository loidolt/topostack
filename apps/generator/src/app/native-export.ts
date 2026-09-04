import { zip, type AsyncZippable } from "fflate";
import type { FabricationPackageV1 } from "@topostack/core";

export interface PreparedDownload {
  blob: Blob;
  filename: string;
  fileCount: number;
}

function archiveFilename(masterFilename: string): string {
  const base = masterFilename
    .replace(/-(?:master|engraving)\.svg$/i, "")
    .replace(/\.[^.]+$/, "");
  return `${base || "topostack-project"}-project-files.zip`;
}

/** Build one browser download containing every fabrication file. */
export async function prepareProjectDownload(output: FabricationPackageV1): Promise<PreparedDownload> {
  if (output.files.length === 1) {
    return { ...output.files[0], fileCount: 1 };
  }

  const entries: AsyncZippable = {};
  await Promise.all(output.files.map(async (file) => {
    entries[file.filename] = new Uint8Array(await file.blob.arrayBuffer());
  }));

  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    zip(entries, { level: 6 }, (error, data) => error ? reject(error) : resolve(data));
  });
  const archive = new Uint8Array(bytes.byteLength);
  archive.set(bytes);
  return {
    filename: archiveFilename(output.master.filename),
    blob: new Blob([archive.buffer], { type: "application/zip" }),
    fileCount: output.files.length,
  };
}

export function startBrowserDownload(download: PreparedDownload): void {
  const url = URL.createObjectURL(download.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = download.filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
