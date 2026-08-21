import type { MarkingFeature, SourceBundleV1 } from "@topostack/core";
import { MAP_DATA_ATTRIBUTION } from "./map-attribution";
import { SAMPLE_PREVIEW } from "./sample-preview.generated";

function decodeElevations(encoded: string): Float32Array {
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  const values = new Float32Array(bytes.length / 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < values.length; index += 1) values[index] = view.getInt16(index * 2, true);
  return values;
}

export function createSamplePreviewSource(): SourceBundleV1 {
  const values = decodeElevations(SAMPLE_PREVIEW.values);
  return {
    schemaVersion: 1,
    elevation: {
      width: SAMPLE_PREVIEW.width,
      height: SAMPLE_PREVIEW.height,
      values,
      min: Math.min(...values),
      max: Math.max(...values),
    },
    markings: SAMPLE_PREVIEW.markings as unknown as MarkingFeature[],
    vectorStatus: "available",
    datasetVersion: "mapzen-terrarium+protomaps-20260819-z11-preview-v1",
    sourceKind: "preview",
    bounds: { ...SAMPLE_PREVIEW.bounds },
    imagerySources: ["srtm/N42W123.tif"],
    resolutionM: 550,
    attribution: MAP_DATA_ATTRIBUTION,
  };
}
