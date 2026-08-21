import { formatNumber as format } from "./format.js";
import { rotatedPoint } from "./geometry2d.js";
import { DEFAULT_TEXT_STYLE, type Point2D, type TextStyleV1 } from "./types.js";

const GLYPHS: Record<string, string[]> = {
  "0": ["111", "101", "101", "101", "111"], "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"], "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"], "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"], "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"], "9": ["111", "101", "111", "001", "111"],
  "A": ["010", "101", "111", "101", "101"], "B": ["110", "101", "110", "101", "110"],
  "C": ["011", "100", "100", "100", "011"], "D": ["110", "101", "101", "101", "110"],
  "E": ["111", "100", "110", "100", "111"], "F": ["111", "100", "110", "100", "100"],
  "G": ["011", "100", "101", "101", "011"], "H": ["101", "101", "111", "101", "101"],
  "I": ["111", "010", "010", "010", "111"], "J": ["001", "001", "001", "101", "010"],
  "K": ["101", "101", "110", "101", "101"], "L": ["100", "100", "100", "100", "111"],
  "M": ["10001", "11011", "10101", "10101", "10101"], "N": ["1001", "1101", "1011", "1001", "1001"],
  "O": ["010", "101", "101", "101", "010"], "P": ["110", "101", "110", "100", "100"],
  "Q": ["010", "101", "101", "011", "001"], "R": ["110", "101", "110", "101", "101"],
  "S": ["011", "100", "010", "001", "110"], "T": ["111", "010", "010", "010", "010"],
  "U": ["101", "101", "101", "101", "111"], "V": ["101", "101", "101", "101", "010"],
  "W": ["10101", "10101", "10101", "10101", "01010"], "X": ["101", "101", "010", "101", "101"],
  "Y": ["101", "101", "010", "010", "010"], "Z": ["111", "001", "010", "100", "111"],
  "m": ["00000", "11011", "10101", "10101", "10101"],
  "f": ["011", "010", "111", "010", "010"], "t": ["010", "111", "010", "010", "011"], "i": ["1", "0", "1", "1", "1"],
  "k": ["100", "101", "110", "101", "101"], "-": ["000", "000", "111", "000", "000"],
  "·": ["000", "000", "010", "000", "000"], ".": ["000", "000", "000", "000", "010"],
  ":": ["000", "010", "000", "010", "000"], "/": ["001", "001", "010", "100", "100"],
  "_": ["000", "000", "000", "000", "111"], "+": ["000", "010", "111", "010", "000"],
  " ": ["0", "0", "0", "0", "0"], "?": ["111", "001", "010", "000", "010"],
};

function glyphFor(character: string): string[] {
  return GLYPHS[character] ?? GLYPHS[character.toUpperCase()] ?? GLYPHS["?"]!;
}

function metrics(style: TextStyleV1): { cell: number; widthScale: number } {
  return { cell: style.sizeMm / 5, widthScale: style.font === "rounded" ? 1.14 : style.font === "stencil" ? 0.84 : 1 };
}

export function labelDimensions(label: string, style: TextStyleV1 = DEFAULT_TEXT_STYLE): { width: number; height: number } {
  const { cell, widthScale } = metrics(style);
  const advances = [...label].map((character) => ((glyphFor(character)[0]?.length ?? 1) + 1) * cell * widthScale);
  return {
    width: Math.max(0, advances.reduce((total, advance) => total + advance, 0) - cell * widthScale),
    height: style.sizeMm,
  };
}

export interface LabelLineSegment { start: Point2D; end: Point2D }

function occupied(glyph: string[], row: number, column: number): boolean {
  return glyph[row]?.[column] === "1";
}

function connectedGlyphSegments(glyph: string[], cursor: number, originY: number, cellX: number, cellY: number): LabelLineSegment[] {
  const segments: LabelLineSegment[] = [];
  glyph.forEach((row, rowIndex) => [...row].forEach((pixel, columnIndex) => {
    if (pixel !== "1") return;
    const center = { x: cursor + (columnIndex + 0.5) * cellX, y: originY + (rowIndex + 0.5) * cellY };
    let connected = false;
    if (occupied(glyph, rowIndex, columnIndex + 1)) {
      segments.push({ start: center, end: { x: center.x + cellX, y: center.y } });
      connected = true;
    }
    const nextColumns = occupied(glyph, rowIndex + 1, columnIndex)
      ? [columnIndex]
      : [columnIndex - 1, columnIndex + 1].filter((column) => occupied(glyph, rowIndex + 1, column));
    nextColumns.forEach((column) => {
      segments.push({ start: center, end: { x: cursor + (column + 0.5) * cellX, y: center.y + cellY } });
      connected = true;
    });
    const hasIncoming = occupied(glyph, rowIndex, columnIndex - 1) || occupied(glyph, rowIndex - 1, columnIndex) ||
      occupied(glyph, rowIndex - 1, columnIndex - 1) || occupied(glyph, rowIndex - 1, columnIndex + 1);
    if (!connected && !hasIncoming) segments.push({ start: { x: center.x - cellX * 0.12, y: center.y }, end: { x: center.x + cellX * 0.12, y: center.y } });
  }));
  return segments;
}

function splitForStencil(segment: LabelLineSegment): LabelLineSegment[] {
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  return [
    { start: segment.start, end: { x: segment.start.x + dx * 0.38, y: segment.start.y + dy * 0.38 } },
    { start: { x: segment.start.x + dx * 0.62, y: segment.start.y + dy * 0.62 }, end: segment.end },
  ];
}

export function labelLineSegments(label: string, origin: Point2D, offsetX = 0, offsetY = 0, rotationRad = 0, style: TextStyleV1 = DEFAULT_TEXT_STYLE): LabelLineSegment[] {
  const { cell, widthScale } = metrics(style);
  let cursor = origin.x + offsetX;
  const segments: LabelLineSegment[] = [];
  for (const character of label) {
    const glyph = glyphFor(character);
    const width = glyph[0]?.length ?? 1;
    const rotationOrigin = { x: origin.x + offsetX, y: origin.y + offsetY };
    const glyphSegments = style.font === "technical"
      ? glyph.flatMap((row, rowIndex) => [...row].flatMap((pixel, columnIndex) => pixel === "1" ? [{
          start: { x: cursor + columnIndex * cell * widthScale, y: origin.y + offsetY + rowIndex * cell },
          end: { x: cursor + (columnIndex + 0.72) * cell * widthScale, y: origin.y + offsetY + rowIndex * cell },
        }] : []))
      : connectedGlyphSegments(glyph, cursor, origin.y + offsetY, cell * widthScale, cell)
        .flatMap((segment) => style.font === "stencil" ? splitForStencil(segment) : [segment]);
    glyphSegments.forEach(({ start, end }) => segments.push({ start: rotatedPoint(start, rotationOrigin, rotationRad), end: rotatedPoint(end, rotationOrigin, rotationRad) }));
    cursor += (width + 1) * cell * widthScale;
  }
  return segments;
}

export function labelPathData(label: string, origin: Point2D, offsetX = 0, offsetY = 0, rotationRad = 0, style: TextStyleV1 = DEFAULT_TEXT_STYLE): string {
  return labelLineSegments(label, origin, offsetX, offsetY, rotationRad, style)
    .map(({ start, end }) => `M${format(start.x)} ${format(start.y)}L${format(end.x)} ${format(end.y)}`)
    .join(" ");
}
