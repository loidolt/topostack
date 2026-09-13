import { pointInPolygon } from "./geometry2d.js";
import { BATHYMETRIC_RELIEF_M } from "./types.js";
import type { ElevationGrid, GeometryWarning, Point2D, ProjectConfigV1, WaterAreaV1, WaterSurfaceIR } from "./types.js";

/**
 * Water depth is not a geometry kind of its own - it is a carve of the
 * elevation grid, applied before contouring. At any (x, y) inside a water body
 * the model should hold material up to the *bed*, not the surface, so writing
 * the bed elevation into the grid makes the whole existing pipeline produce the
 * recess: d3-contour cuts the rings, clipContours winds them as holes, and
 * every consumer downstream already honours holes.
 *
 * The basin itself follows GLOBathy, whose published rasters are a derived
 * product of just two inputs - a HydroLAKES polygon and a maximum depth -
 * combined by a proximity-to-shore pass and `D = l * Dmax / L`. We reproduce
 * that at whatever resolution the model needs instead of shipping their 16.7 GB
 * of TIFFs, and generalize the straight line to `D = Dmax * (l / L)^p` so the
 * profile can bend. See `solveShapeExponent` for what fixes `p`.
 */

/** Fraction of a cell the border samples move inward; see `cellPoint`. */
const EDGE_INSET = 1e-3;

const MIN_SHAPE_EXPONENT = 0.2;
const MAX_SHAPE_EXPONENT = 8;
const SHAPE_HISTOGRAM_BINS = 256;
const SHAPE_SOLVE_ITERATIONS = 40;

/**
 * Cell (i, j) at the same mm coordinate `sampleElevation` reads it from, with
 * the outermost row and column nudged a hair inward.
 *
 * Edge samples sit exactly on the crop boundary, and so does the edge of any
 * water polygon clipped to that crop. Ray casting cannot decide a point lying
 * on the ring, so an ocean running off the map would drop its border cells from
 * the mask - and those are the deepest cells, which would then be counted as
 * land and drag the whole stack back down to the sea floor.
 */
function cellPoint(column: number, row: number, grid: ElevationGrid, config: ProjectConfigV1): Point2D {
  const insetX = column === 0 ? EDGE_INSET : column === grid.width - 1 ? -EDGE_INSET : 0;
  const insetY = row === 0 ? EDGE_INSET : row === grid.height - 1 ? -EDGE_INSET : 0;
  return {
    x: (column / (grid.width - 1) - 0.5 + insetX / (grid.width - 1)) * config.widthMm,
    y: (row / (grid.height - 1) - 0.5 + insetY / (grid.height - 1)) * config.heightMm,
  };
}

/**
 * Felzenszwalb & Huttenlocher's exact squared distance transform, one axis at a
 * time. `spacing` is the ground distance between neighbouring samples on this
 * axis, which is what turns the result from cells into meters - grid cells are
 * not square once the crop is not square.
 *
 * Cells beyond the array are simply absent rather than seeded, so a lake that
 * runs off the edge of the window is not given a false shoreline there.
 */
function distanceTransform1D(f: Float64Array, n: number, spacing: number): Float64Array {
  const weight = spacing * spacing;
  const result = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
  const vertices = new Int32Array(n);
  const breaks = new Float64Array(n + 1);
  let count = -1;
  for (let q = 0; q < n; q += 1) {
    if (!Number.isFinite(f[q]!)) continue;
    if (count < 0) {
      count = 0;
      vertices[0] = q;
      breaks[0] = Number.NEGATIVE_INFINITY;
      breaks[1] = Number.POSITIVE_INFINITY;
      continue;
    }
    let separation = 0;
    while (count >= 0) {
      const v = vertices[count]!;
      separation = ((f[q]! + weight * q * q) - (f[v]! + weight * v * v)) / (2 * weight * q - 2 * weight * v);
      if (separation > breaks[count]!) break;
      count -= 1;
    }
    if (count < 0) {
      count = 0;
      vertices[0] = q;
      breaks[0] = Number.NEGATIVE_INFINITY;
      breaks[1] = Number.POSITIVE_INFINITY;
    } else {
      count += 1;
      vertices[count] = q;
      breaks[count] = separation;
      breaks[count + 1] = Number.POSITIVE_INFINITY;
    }
  }
  if (count < 0) return result;
  let index = 0;
  for (let q = 0; q < n; q += 1) {
    while (breaks[index + 1]! < q) index += 1;
    const v = vertices[index]!;
    result[q] = weight * (q - v) * (q - v) + f[v]!;
  }
  return result;
}

/**
 * Distance in meters from each masked cell to the nearest unmasked one. Cells
 * outside the mask seed the transform at zero; everything else starts unseeded,
 * so a mask that touches the window edge measures to real shoreline only.
 */
export function distanceToShoreM(mask: Uint8Array, width: number, height: number, spacingXM: number, spacingYM: number): Float64Array {
  const squared = new Float64Array(width * height);
  const column = new Float64Array(height);
  const row = new Float64Array(width);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) row[x] = mask[y * width + x] ? Number.POSITIVE_INFINITY : 0;
    const transformed = distanceTransform1D(row, width, spacingXM);
    for (let x = 0; x < width; x += 1) squared[y * width + x] = transformed[x]!;
  }
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) column[y] = squared[y * width + x]!;
    const transformed = distanceTransform1D(column, height, spacingYM);
    for (let y = 0; y < height; y += 1) squared[y * width + x] = transformed[y]!;
  }
  const distance = new Float64Array(width * height);
  for (let index = 0; index < distance.length; index += 1) distance[index] = Math.sqrt(squared[index]!);
  return distance;
}

/**
 * Choose the profile exponent so the modeled basin holds the mean depth
 * HydroLAKES reports.
 *
 * This is the one place real shape information enters. GLOBathy's own
 * head-Area-Volume curves are fitted *from* its conical rasters, so they cannot
 * bend the profile; `Depth_avg` can, because it is `Vol_total / Lake_area` from
 * Messager et al.'s geostatistical model, which never saw the distance
 * transform. A straight cone always averages about a third of its maximum, and
 * the shipped ratios spread either side of it - Tahoe 0.56 (steep walls, p~0.45),
 * Superior 0.36 (near-conical, p~0.91), Crater Lake 0.25 (p~1.36) - a difference
 * that is plainly visible once the basin is cut into sheets.
 *
 * Treat the ratio as the best available estimate, not ground truth: HydroLAKES
 * derives it from a modeled volume, which is close for Tahoe but understates an
 * unusual caldera like Crater Lake by more than half. The per-lake maximum-depth
 * override exists for the cases a reader will notice.
 *
 * `mean(u^p)` falls monotonically with `p`, so bisection converges. It runs
 * against a histogram of `u` rather than the cells themselves, which keeps the
 * solve at a few thousand operations instead of tens of millions.
 */
export function solveShapeExponent(normalized: Float64Array, count: number, targetRatio: number): number {
  if (!(targetRatio > 0) || !(targetRatio < 1) || count === 0) return 1;
  const histogram = new Float64Array(SHAPE_HISTOGRAM_BINS);
  for (let index = 0; index < count; index += 1) {
    const bin = Math.min(SHAPE_HISTOGRAM_BINS - 1, Math.max(0, Math.round(normalized[index]! * (SHAPE_HISTOGRAM_BINS - 1))));
    histogram[bin] = (histogram[bin] ?? 0) + 1;
  }
  const meanPower = (exponent: number): number => {
    let total = 0;
    for (let bin = 0; bin < SHAPE_HISTOGRAM_BINS; bin += 1) {
      const weight = histogram[bin]!;
      if (weight === 0) continue;
      total += weight * (bin / (SHAPE_HISTOGRAM_BINS - 1)) ** exponent;
    }
    return total / count;
  };
  if (meanPower(MIN_SHAPE_EXPONENT) < targetRatio) return MIN_SHAPE_EXPONENT;
  if (meanPower(MAX_SHAPE_EXPONENT) > targetRatio) return MAX_SHAPE_EXPONENT;
  let low = MIN_SHAPE_EXPONENT;
  let high = MAX_SHAPE_EXPONENT;
  for (let iteration = 0; iteration < SHAPE_SOLVE_ITERATIONS; iteration += 1) {
    const middle = (low + high) / 2;
    if (meanPower(middle) > targetRatio) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

function quantile(sorted: Float64Array, count: number, fraction: number): number {
  if (count === 0) return 0;
  return sorted[Math.min(count - 1, Math.max(0, Math.round(fraction * (count - 1))))] ?? 0;
}

export interface CarvedWater {
  grid: ElevationGrid;
  surfaces: WaterSurfaceIR[];
  warnings: GeometryWarning[];
  /**
   * Every cell covered by water, carved or surveyed. The stack budget is sized
   * from land alone, so it needs to know which cells to leave out of that.
   */
  waterMask: Uint8Array;
}

/**
 * Write modeled lake beds into a copy of the elevation grid.
 *
 * Oceans are never carved: Terrarium already carries real soundings for them,
 * and the `BATHYMETRIC_RELIEF_M` guard extends that courtesy to any water body
 * whose DEM interior already varies - so a better DEM arriving later is
 * respected automatically rather than being flattened back to a model.
 */
export function carveWaterDepth(
  grid: ElevationGrid,
  config: ProjectConfigV1,
  areas: readonly WaterAreaV1[],
  groundWidthM: number,
  groundHeightM = groundWidthM * (grid.height - 1) / (grid.width - 1),
): CarvedWater {
  // Applies to surveyed water as much as modeled: a reader raising the control
  // expects the sea floor to deepen alongside the lakes, and the ocean's depth
  // lives in the DEM rather than in anything this function writes.
  const exaggeration = Number.isFinite(config.waterDepthExaggeration) && config.waterDepthExaggeration >= 0
    ? config.waterDepthExaggeration
    : 1;
  const surfaces: WaterSurfaceIR[] = [];
  const warnings: GeometryWarning[] = [];
  const values = Float32Array.from(grid.values);
  const waterMask = new Uint8Array(grid.width * grid.height);
  if (!areas.length) return { grid: { ...grid, values }, surfaces, warnings, waterMask };

  // The geographic footprint is independent of physical output stretching.
  const spacingXM = groundWidthM / Math.max(1, grid.width - 1);
  const spacingYM = groundHeightM / Math.max(1, grid.height - 1);

  const mask = new Uint8Array(grid.width * grid.height);
  const interior = new Float64Array(grid.width * grid.height);
  const normalized = new Float64Array(grid.width * grid.height);
  const cells: number[] = [];

  for (const area of areas) {
    mask.fill(0);
    cells.length = 0;
    let count = 0;
    for (let row = 0; row < grid.height; row += 1) {
      for (let column = 0; column < grid.width; column += 1) {
        if (!pointInPolygon(cellPoint(column, row, grid, config), area.polygon)) continue;
        const index = row * grid.width + column;
        mask[index] = 1;
        waterMask[index] = 1;
        cells.push(index);
        interior[count] = values[index]!;
        count += 1;
      }
    }
    if (count === 0) continue;

    const sorted = interior.slice(0, count).sort();
    const surfaceLevelM = quantile(sorted, count, 0.5);
    // Judge "does the DEM already know this basin?" on the middle of the
    // distribution, not its extremes. A lake outline traced by HydroLAKES never
    // lands exactly on Terrarium's rendering of the same shoreline, and a
    // handful of steep rim cells caught inside the polygon would otherwise
    // condemn the whole lake to being read as surveyed and left flat.
    const interiorSpreadM = quantile(sorted, count, 0.9) - quantile(sorted, count, 0.1);

    // The DEM already knows this basin, so its shape is left alone - but its
    // depth is still scaled, so surveyed and modeled water answer to the same
    // control. At 1x nothing is written and the survey passes through exactly.
    if (area.kind === "ocean" || interiorSpreadM > BATHYMETRIC_RELIEF_M) {
      const surveyedSurfaceM = area.kind === "ocean" ? 0 : surfaceLevelM;
      let surveyedBedM = quantile(sorted, count, 0);
      if (exaggeration !== 1) {
        surveyedBedM = surveyedSurfaceM;
        for (const index of cells) {
          const depth = surveyedSurfaceM - values[index]!;
          if (depth <= 0) continue;
          const scaled = surveyedSurfaceM - depth * exaggeration;
          values[index] = scaled;
          if (scaled < surveyedBedM) surveyedBedM = scaled;
        }
      }
      surfaces.push({
        id: area.id,
        kind: area.kind,
        ...(area.name ? { name: area.name } : {}),
        ...(area.hylakId === undefined ? {} : { hylakId: area.hylakId }),
        polygons: [area.polygon],
        surfaceElevationM: surveyedSurfaceM,
        bedElevationM: surveyedBedM,
        layerIndex: 0,
        depthSource: "surveyed",
      });
      continue;
    }

    const sourceMaxDepthM = area.maxDepthM;
    const maxDepthM = sourceMaxDepthM === undefined ? undefined : sourceMaxDepthM * exaggeration;
    if (!(maxDepthM && maxDepthM > 0) || sourceMaxDepthM === undefined) continue;

    // Take the surface from our own DEM rather than HydroLAKES' `Elevation`.
    // The lake is flat here, so the median *is* the surface, and it is stated in
    // the same datum as the surrounding land - borrowing EarthEnv-DEM90's figure
    // instead would leave a step at the shoreline wherever the two disagree.
    const surfaceElevationM = surfaceLevelM;

    const distance = distanceToShoreM(mask, grid.width, grid.height, spacingXM, spacingYM);
    // No shoreline in view means no way to place these cells within the basin.
    if (cells.some((index) => !Number.isFinite(distance[index]!))) {
      warnings.push({
        code: "WATER_DEPTH_CLAMPED",
        message: `${area.name ?? "A lake"} extends past the edge of this map, so its depth could not be modeled. Zoom out to include its shoreline.`,
      });
      continue;
    }

    const lmaxM = area.lmaxM && area.lmaxM > 0 ? area.lmaxM : Math.max(...cells.map((index) => distance[index]!));
    if (!(lmaxM > 0)) continue;
    for (let index = 0; index < cells.length; index += 1) normalized[index] = Math.min(1, distance[cells[index]!]! / lmaxM);

    // A clipped lake's visible cells are not a fair sample of the whole basin,
    // so fitting an exponent to them would bend the profile to the crop rather
    // than to the lake. Fall back to GLOBathy's straight line there.
    const exponent = area.clipped || !(area.meanDepthM && area.meanDepthM > 0)
      ? 1
      // Exaggeration scales both the maximum and mean depth, so it must not
      // change their ratio (and therefore the basin shape). The source maximum
      // may include a user override; retaining the published mean then bends
      // the overridden profile while the display multiplier remains uniform.
      : solveShapeExponent(normalized, cells.length, area.meanDepthM / sourceMaxDepthM);

    let bedElevationM = surfaceElevationM;
    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index]!;
      // Only ever cut downward from the waterline. Where a lake outline spills a
      // little past the shore, those cells are land standing above the surface,
      // and gouging them would carve a moat into the bank.
      if (values[cell]! > surfaceElevationM + BATHYMETRIC_RELIEF_M) continue;
      const bed = surfaceElevationM - maxDepthM * normalized[index]! ** exponent;
      values[cell] = bed;
      if (bed < bedElevationM) bedElevationM = bed;
    }

    surfaces.push({
      id: area.id,
      kind: area.kind,
      ...(area.name ? { name: area.name } : {}),
      ...(area.hylakId === undefined ? {} : { hylakId: area.hylakId }),
      polygons: [area.polygon],
      surfaceElevationM,
      bedElevationM,
      maxDepthM: sourceMaxDepthM,
      layerIndex: 0,
      depthSource: area.depthSource ?? "modeled",
    });
  }

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { grid: { ...grid, values, min, max }, surfaces, warnings, waterMask };
}

/**
 * Raise every cell that the sheet ladder cannot reach. The ladder is bounded by
 * `MAX_DEPTH_LAYER_COUNT`, so a deep lake on a low-relief map would otherwise
 * ask for dozens of sheets; flattening its floor keeps the model fabricable and
 * the warning keeps that honest.
 */
export function clampCarveToLadder(grid: ElevationGrid, floorM: number): { grid: ElevationGrid; clamped: boolean } {
  if (!(grid.min < floorM)) return { grid, clamped: false };
  const values = Float32Array.from(grid.values);
  let min = Number.POSITIVE_INFINITY;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index]! < floorM) values[index] = floorM;
    if (values[index]! < min) min = values[index]!;
  }
  return { grid: { ...grid, values, min }, clamped: true };
}
