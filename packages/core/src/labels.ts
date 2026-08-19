import type { Point2D } from "./types.js";

const CELL_MM = 0.62;

const GLYPHS: Record<string, string[]> = {
  "0": ["111", "101", "101", "101", "111"], "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"], "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"], "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"], "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"], "9": ["111", "101", "111", "001", "111"],
  "L": ["100", "100", "100", "100", "111"], "m": ["000", "110", "101", "101", "101"],
  "k": ["100", "101", "110", "101", "101"], "-": ["000", "000", "111", "000", "000"],
  "·": ["000", "000", "010", "000", "000"], ".": ["000", "000", "000", "000", "010"],
  " ": ["0", "0", "0", "0", "0"],
};

function glyphFor(character: string): string[] {
  return GLYPHS[character] ?? GLYPHS[" "]!;
}

function format(value: number): string {
  return Number(value.toFixed(3)).toString();
}

export function labelDimensions(label: string): { width: number; height: number } {
  const advances = [...label].map((character) => ((glyphFor(character)[0]?.length ?? 1) + 1) * CELL_MM);
  return {
    width: Math.max(0, advances.reduce((total, advance) => total + advance, 0) - CELL_MM),
    height: CELL_MM * 5,
  };
}

export function labelPathData(label: string, origin: Point2D, offsetX = 0, offsetY = 0): string {
  let cursor = origin.x + offsetX;
  const commands: string[] = [];
  for (const character of label) {
    const glyph = glyphFor(character);
    const width = glyph[0]?.length ?? 1;
    glyph.forEach((row, rowIndex) => [...row].forEach((pixel, columnIndex) => {
      if (pixel === "1") commands.push(`M${format(cursor + columnIndex * CELL_MM)} ${format(origin.y + offsetY + rowIndex * CELL_MM)}h${format(CELL_MM * 0.72)}`);
    }));
    cursor += (width + 1) * CELL_MM;
  }
  return commands.join(" ");
}
