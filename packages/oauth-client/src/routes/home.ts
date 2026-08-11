import type { FastifyInstance } from "fastify";
import {
  readLocalSession,
  touchLocalSession,
  type ActivityRow,
  type LocalStore,
  type ProcessedRow,
  type ProfileRow,
} from "../store.js";
import { renderPage, renderPartial } from "../views.js";

const PANEL_LIMIT = 12;

interface Panels {
  processedEvents: ProcessedRow[];
  activity: ActivityRow[];
}

async function loadPanels(store: LocalStore): Promise<Panels> {
  const [processedEvents, activity] = await Promise.all([
    store.processedEvent.findMany({
      orderBy: { processedAt: "desc" },
      take: PANEL_LIMIT,
    }),
    store.activityLog.findMany({
      orderBy: { createdAt: "desc" },
      take: PANEL_LIMIT,
    }),
  ]);
  return { processedEvents, activity };
}

function groupsOf(profile: ProfileRow): string[] {
  return Array.isArray(profile.groups) ? (profile.groups as string[]) : [];
}

export async function registerHomeRoutes(app: FastifyInstance): Promise<void> {
  const { config, store } = app.rely;

  app.get("/", async (request, reply) => {
    const session = await readLocalSession(store, request.cookies[config.sessionCookie]);
    const panels = await loadPanels(store);

    if (session.state !== "active") {
      return reply.type("text/html; charset=utf-8").send(
        renderPage(
          "signed-out",
          {
            ...panels,
            sessionState: session.state,
            revokeReason: session.state === "revoked" ? session.row.revokeReason : null,
          },
          { config, title: config.name },
        ),
      );
    }

    await touchLocalSession(store, session.row.id);
    const profile = await store.profileCache.findUnique({
      where: { externalUserId: session.row.externalUserId },
    });

    if (profile === null) {
      return reply.type("text/html; charset=utf-8").send(
        renderPage(
          "signed-out",
          { ...panels, sessionState: "none", revokeReason: null },
          { config, title: config.name },
        ),
      );
    }

    return reply.type("text/html; charset=utf-8").send(
      renderPage(
        "home",
        {
          ...panels,
          session: session.row,
          profile: { ...profile, groups: groupsOf(profile) },
        },
        { config, title: config.name },
      ),
    );
  });

  app.get("/fragments/processed-events", async (_request, reply) => {
    const panels = await loadPanels(store);
    return reply
      .type("text/html; charset=utf-8")
      .send(renderPartial("partials/processed-events", panels));
  });

  app.get("/fragments/activity", async (_request, reply) => {
    const panels = await loadPanels(store);
    return reply
      .type("text/html; charset=utf-8")
      .send(renderPartial("partials/activity", panels));
  });

  app.get("/healthz", async (_request, reply) => {
    try {
      await store.processedEvent.findMany({ orderBy: { processedAt: "desc" }, take: 1 });
      return { status: "ok" };
    } catch {
      return reply.status(503).send({ status: "unavailable" });
    }
  });
}
