import { themeScript } from "@loidolt/theme-svelte";
import type { Handle } from "@sveltejs/kit";
import { THEME_OPTIONS } from "./lib/theme";

const initialThemeScript = themeScript(THEME_OPTIONS);

export const handle: Handle = ({ event, resolve }) =>
  resolve(event, {
    transformPageChunk: ({ html }) => html.replace("%loidolt.theme%", initialThemeScript),
  });
