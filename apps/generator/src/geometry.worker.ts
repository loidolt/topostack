import { generateGeometry, type ProjectConfigV1, type SourceBundleV1 } from "@topostack/core";

interface GeometryRequest {
  id: number;
  config: ProjectConfigV1;
  source: SourceBundleV1;
}

self.onmessage = (event: MessageEvent<GeometryRequest>) => {
  try {
    const result = generateGeometry(event.data.config, event.data.source);
    self.postMessage({ id: event.data.id, result });
  } catch (error) {
    self.postMessage({ id: event.data.id, error: error instanceof Error ? error.message : "Geometry generation failed." });
  }
};
