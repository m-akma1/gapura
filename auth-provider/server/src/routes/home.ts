import type { FastifyInstance } from "fastify";
import { currentSession } from "../session-context.js";
import { renderPage } from "../views.js";

export async function registerHomeRoutes(app: FastifyInstance): Promise<void> {
  const { prisma } = app.ctx;

  app.get("/", async (request, reply) => {
    const context = await currentSession(request);

    if (context === null) {
      return reply
        .type("text/html; charset=utf-8")
        .send(renderPage("home-anonymous", {}, { title: "Gapura" }));
    }

    const [sessions, applications] = await Promise.all([
      prisma.ssoSession.findMany({
        where: { userId: context.session.userId, status: "active" },
        select: {
          id: true,
          createdAt: true,
          expiresAt: true,
          lastActivityAt: true,
          ipAddress: true,
          userAgent: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.application.findMany({
        where: { status: "active" },
        select: { name: true, launchUrl: true },
        orderBy: { name: "asc" },
      }),
    ]);

    return reply.type("text/html; charset=utf-8").send(
      renderPage(
        "home",
        {
          sessions,
          applications,
          currentSessionId: context.session.id,
          user: context.session.user,
        },
        {
          title: "Gapura",
          currentUser: context.session.user,
          isAdmin: context.isAdmin,
        },
      ),
    );
  });
}
