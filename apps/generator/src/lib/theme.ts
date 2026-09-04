import { createTheme } from "@loidolt/theme-svelte";

export const THEME_OPTIONS = {
  storageKey: "topostack-theme",
  defaultPreference: "system",
  defaultScheme: "light",
} as const;

export const theme = createTheme(THEME_OPTIONS);
