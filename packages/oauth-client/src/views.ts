import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Eta } from "eta";
import type { RelyingAppConfig } from "./config.js";

const here = dirname(fileURLToPath(import.meta.url));
const viewsDir = join(here, "..", "views");

const eta = new Eta({ views: viewsDir, cache: true });

export interface LayoutData {
  config: RelyingAppConfig;
  title: string;
}

export function renderPage(
  template: string,
  data: Record<string, unknown>,
  layout: LayoutData,
): string {
  const body = eta.render(template, { ...data, config: layout.config });
  return eta.render("layout", { ...layout, body });
}

/** Renders a partial on its own, for the htmx fragment routes. */
export function renderPartial(template: string, data: object): string {
  return eta.render(template, data);
}
