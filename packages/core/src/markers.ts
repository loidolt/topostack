import type { GeoBounds, MarkerSymbol, Point2D } from "./types.js";

function circle(center: Point2D, radius: number, steps = 24): Point2D[] {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = index / steps * Math.PI * 2;
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
  });
}

function thickSegment(start: Point2D, end: Point2D, width: number): Point2D[] {
  const length = Math.hypot(end.x - start.x, end.y - start.y) || 1;
  const offsetX = -(end.y - start.y) / length * width / 2;
  const offsetY = (end.x - start.x) / length * width / 2;
  return [
    { x: start.x + offsetX, y: start.y + offsetY },
    { x: end.x + offsetX, y: end.y + offsetY },
    { x: end.x - offsetX, y: end.y - offsetY },
    { x: start.x - offsetX, y: start.y - offsetY },
    { x: start.x + offsetX, y: start.y + offsetY },
  ];
}

/** Fabrication-safe line paths for the marker picker, previews, and SVG output. */
export function markerSymbolPaths(symbol: MarkerSymbol, center: Point2D, size: number): Point2D[][] {
  const radius = size / 2;
  if (symbol === "circle") return [circle(center, radius * 0.78)];
  if (symbol === "cross") {
    const extent = radius * 0.72;
    const width = Math.max(size * 0.16, 0.8);
    return [
      thickSegment({ x: center.x - extent, y: center.y - extent }, { x: center.x + extent, y: center.y + extent }, width),
      thickSegment({ x: center.x + extent, y: center.y - extent }, { x: center.x - extent, y: center.y + extent }, width),
    ];
  }
  if (symbol === "triangle") return [[
    { x: center.x, y: center.y - radius * 0.88 },
    { x: center.x + radius * 0.82, y: center.y + radius * 0.66 },
    { x: center.x - radius * 0.82, y: center.y + radius * 0.66 },
    { x: center.x, y: center.y - radius * 0.88 },
  ]];
  if (symbol === "star") {
    return [Array.from({ length: 11 }, (_, index) => {
      const point = index % 10;
      const angle = -Math.PI / 2 + point * Math.PI / 5;
      const pointRadius = point % 2 === 0 ? radius * 0.92 : radius * 0.4;
      return { x: center.x + Math.cos(angle) * pointRadius, y: center.y + Math.sin(angle) * pointRadius };
    })];
  }
  return [
    [
      { x: center.x, y: center.y + radius },
      { x: center.x - radius * 0.38, y: center.y + radius * 0.28 },
      { x: center.x - radius * 0.66, y: center.y - radius * 0.12 },
      { x: center.x - radius * 0.58, y: center.y - radius * 0.52 },
      { x: center.x - radius * 0.3, y: center.y - radius * 0.82 },
      { x: center.x, y: center.y - radius * 0.92 },
      { x: center.x + radius * 0.3, y: center.y - radius * 0.82 },
      { x: center.x + radius * 0.58, y: center.y - radius * 0.52 },
      { x: center.x + radius * 0.66, y: center.y - radius * 0.12 },
      { x: center.x + radius * 0.38, y: center.y + radius * 0.28 },
      { x: center.x, y: center.y + radius },
    ],
    circle({ x: center.x, y: center.y - radius * 0.3 }, radius * 0.19, 16),
  ];
}

function mercatorWorldY(latitude: number): number {
  const radians = Math.max(-85.0511, Math.min(85.0511, latitude)) * Math.PI / 180;
  return (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2;
}

/** Project a geographic coordinate into the artwork's centered millimeter space. */
export function geoPointToMapPoint(lat: number, lon: number, bounds: GeoBounds, widthMm: number, heightMm: number): Point2D {
  const northY = mercatorWorldY(bounds.north);
  const southY = mercatorWorldY(bounds.south);
  return {
    x: ((lon - bounds.west) / (bounds.east - bounds.west) - 0.5) * widthMm,
    y: ((mercatorWorldY(lat) - northY) / (southY - northY) - 0.5) * heightMm,
  };
}
