import type { UnitSystem } from "./types.js";

export const MM_PER_INCH = 25.4;
export const FEET_PER_METER = 3.280839895;

export function displayLength(valueMm: number, units: UnitSystem): number {
  return units === "imperial" ? valueMm / MM_PER_INCH : valueMm;
}

export function millimetersFromDisplay(value: number, units: UnitSystem): number {
  return units === "imperial" ? value * MM_PER_INCH : value;
}

export function displayElevation(valueM: number, units: UnitSystem): number {
  return units === "imperial" ? valueM * FEET_PER_METER : valueM;
}

export function lengthUnit(units: UnitSystem): "in" | "mm" {
  return units === "imperial" ? "in" : "mm";
}

export function elevationUnit(units: UnitSystem): "ft" | "m" {
  return units === "imperial" ? "ft" : "m";
}
