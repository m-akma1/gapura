import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Eta } from "eta";

const here = dirname(fileURLToPath(import.meta.url));
const viewsDir = join(here, "..", "views");

const eta = new Eta({ views: viewsDir, cache: true });

export interface LayoutData {
  title: string;
  currentUser?: { name: string; email: string } | undefined;
  isAdmin?: boolean;
  activeNav?: string | undefined;
}

export function renderPage(
  template: string,
  data: Record<string, unknown>,
  layout: LayoutData,
): string {
  const body = eta.render(template, data);
  return eta.render("layout", { ...layout, body });
}
