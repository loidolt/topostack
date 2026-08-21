import { formatNumber as format } from "./format.js";
import { rotatedPoint } from "./geometry2d.js";
import type { Point2D } from "./types.js";

const CELL_MM = 0.62;

const GLYPHS: Record<string, string[]> = {
  "0": ["111", "101", "101", "101", "111"], "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"], "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"], "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"], "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"], "9": ["111", "101", "111", "001", "111"],
  "L": ["100", "100", "100", "100", "111"], "m": ["00000", "11011", "10101", "10101", "10101"],
  "f": ["011", "010", "111", "010", "010"], "t": ["010", "111", "010", "010", "011"], "i": ["1", "0", "1", "1", "1"],
  "k": ["100", "101", "110", "101", "101"], "-": ["000", "000", "111", "000", "000"],
  "·": ["000", "000", "010", "000", "000"], ".": ["000", "000", "000", "000", "010"],
  " ": ["0", "0", "0", "0", "0"],
};

function glyphFor(character: string): string[] {
  return GLYPHS[character] ?? GLYPHS[" "]!;
}

export function labelDimensions(label: string): { width: number; height: number } {
  const advances = [...label].map((character) => ((glyphFor(character)[0]?.length ?? 1) + 1) * CELL_MM);
  return {
    width: Math.max(0, advances.reduce((total, advance) => total + advance, 0) - CELL_MM),
    height: CELL_MM * 5,
  };
}

export interface LabelLineSegment { start: Point2D; end: Point2D }

export function labelLineSegments(label: string, origin: Point2D, offsetX = 0, offsetY = 0, rotationRad = 0): LabelLineSegment[] {
  let cursor = origin.x + offsetX;
  const segments: LabelLineSegment[] = [];
  for (const character of label) {
    const glyph = glyphFor(character);
    const width = glyph[0]?.length ?? 1;
    glyph.forEach((row, rowIndex) => [...row].forEach((pixel, columnIndex) => {
      if (pixel !== "1") return;
      const start = { x: cursor + columnIndex * CELL_MM, y: origin.y + offsetY + rowIndex * CELL_MM };
      const end = { x: start.x + CELL_MM * 0.72, y: start.y };
      const rotationOrigin = { x: origin.x + offsetX, y: origin.y + offsetY };
      segments.push({ start: rotatedPoint(start, rotationOrigin, rotationRad), end: rotatedPoint(end, rotationOrigin, rotationRad) });
    }));
    cursor += (width + 1) * CELL_MM;
  }
  return segments;
}

export function labelPathData(label: string, origin: Point2D, offsetX = 0, offsetY = 0, rotationRad = 0): string {
  return labelLineSegments(label, origin, offsetX, offsetY, rotationRad)
    .map(({ start, end }) => `M${format(start.x)} ${format(start.y)}L${format(end.x)} ${format(end.y)}`)
    .join(" ");
}
