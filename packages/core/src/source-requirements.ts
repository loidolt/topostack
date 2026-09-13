import type { ProjectConfigV1 } from "./types.js";

/** Source capabilities required by both generation and fabrication exports. */
export function sourceRequirements(config: ProjectConfigV1): { vectors: boolean; lakes: boolean } {
  const lakes = config.outputMode === "stack" && config.showWaterDepth;
  return { vectors: config.showRoads || config.showTrails || config.showWater || config.showBoundaries || lakes, lakes };
}
