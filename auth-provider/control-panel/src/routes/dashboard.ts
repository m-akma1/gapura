import type { FastifyInstance } from "fastify";
import { renderPage } from "../views.js";

export async function registerDashboardRoutes(app: FastifyInstance): Promise<void> {
  const { prisma } = app.ctx;

  app.get("/admin", async (request, reply) => {
    const [users, groups, applications, policies, activeSessions] = await Promise.all([
      prisma.user.count(),
      prisma.group.count(),
      prisma.application.count(),
      prisma.applicationGroupPolicy.count(),
      prisma.ssoSession.count({ where: { status: "active" } }),
    ]);

    const recentAudit = await prisma.auditLog.findMany({
      select: { eventType: true, result: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    return reply.type("text/html; charset=utf-8").send(
      renderPage(
        "dashboard",
        { users, groups, applications, policies, activeSessions, recentAudit },
        {
          title: "Control panel",
          currentUser: request.admin.user,
          activeNav: "dashboard",
        },
      ),
    );
  });
}
