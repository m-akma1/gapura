import {
  AuditEvent,
  AuditResult,
  emitEvent,
  revokeAllUserSessions,
  writeAudit,
} from "@gapura/auth-core";
import { EventType, RevokeReason } from "@gapura/contracts";
import { hashPassword } from "@gapura/crypto";
import type { FastifyInstance } from "fastify";
import { setFlash, takeFlash } from "../flash.js";
import { renderPage } from "../views.js";

interface CreateUserBody {
  name?: string;
  email?: string;
  password?: string;
}

interface UpdateUserBody {
  name?: string;
  email?: string;
}

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  const { prisma } = app.ctx;

  app.get("/admin/users", async (request, reply) => {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        createdAt: true,
        _count: { select: { memberships: true, ssoSessions: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    return reply.type("text/html; charset=utf-8").send(
      renderPage(
        "users",
        { users },
        {
          title: "Users",
          currentUser: request.admin.user,
          activeNav: "users",
          flash: takeFlash(request, reply),
        },
      ),
    );
  });

  app.post<{ Body: CreateUserBody }>("/admin/users", async (request, reply) => {
    const name = (request.body.name ?? "").trim();
    const email = (request.body.email ?? "").trim().toLowerCase();
    const password = request.body.password ?? "";

    if (name === "" || email === "" || password.length < 8) {
      setFlash(reply, "Name, email, and a password of at least 8 characters are required");
      return reply.redirect("/admin/users");
    }

    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing !== null) {
      setFlash(reply, "That email is already registered");
      return reply.redirect("/admin/users");
    }

    const passwordHash = await hashPassword(password);
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { name, email, passwordHash },
        select: { id: true },
      });
      await writeAudit(tx, {
        eventType: AuditEvent.UserCreated,
        result: AuditResult.Success,
        actorId: request.admin.userId,
        userId: user.id,
        ipAddress: request.ip,
        correlationId: request.correlationId,
      });
    });

    setFlash(reply, `User ${email} created`);
    return reply.redirect("/admin/users");
  });

  app.get<{ Params: { id: string } }>("/admin/users/:id", async (request, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: request.params.id },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        memberships: {
          select: { group: { select: { id: true, name: true } } },
          orderBy: { group: { name: "asc" } },
        },
        ssoSessions: {
          where: { status: "active" },
          select: { id: true, createdAt: true, expiresAt: true, ipAddress: true },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (user === null) {
      setFlash(reply, "User not found");
      return reply.redirect("/admin/users");
    }

    const allGroups = await prisma.group.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    const memberOf = new Set(user.memberships.map((m) => m.group.id));

    return reply.type("text/html; charset=utf-8").send(
      renderPage(
        "user-detail",
        {
          user,
          availableGroups: allGroups.filter((g) => !memberOf.has(g.id)),
        },
        {
          title: user.name,
          currentUser: request.admin.user,
          activeNav: "users",
          flash: takeFlash(request, reply),
        },
      ),
    );
  });

  app.post<{ Params: { id: string }; Body: UpdateUserBody }>(
    "/admin/users/:id",
    async (request, reply) => {
      const name = (request.body.name ?? "").trim();
      const email = (request.body.email ?? "").trim().toLowerCase();

      if (name === "" || email === "") {
        setFlash(reply, "Name and email are required");
        return reply.redirect(`/admin/users/${request.params.id}`);
      }

      const clash = await prisma.user.findFirst({
        where: { email, NOT: { id: request.params.id } },
        select: { id: true },
      });
      if (clash !== null) {
        setFlash(reply, "That email is already registered");
        return reply.redirect(`/admin/users/${request.params.id}`);
      }

      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: request.params.id },
          data: { name, email },
        });
        await writeAudit(tx, {
          eventType: AuditEvent.UserUpdated,
          result: AuditResult.Success,
          actorId: request.admin.userId,
          userId: request.params.id,
          ipAddress: request.ip,
          correlationId: request.correlationId,
        });
      });

      setFlash(reply, "User updated");
      return reply.redirect(`/admin/users/${request.params.id}`);
    },
  );

  app.post<{ Params: { id: string }; Body: { status?: string } }>(
    "/admin/users/:id/status",
    async (request, reply) => {
      const target = request.body.status === "active" ? "active" : "inactive";

      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: request.params.id },
          data: { status: target },
        });

        if (target === "inactive") {
          const revoked = await revokeAllUserSessions(
            tx,
            request.params.id,
            RevokeReason.UserDeactivated,
          );
          for (const sessionId of revoked) {
            await emitEvent(tx, {
              eventType: EventType.SessionRevoked,
              userId: request.params.id,
              centralSessionId: sessionId,
              reason: RevokeReason.UserDeactivated,
              correlationId: request.correlationId,
            });
          }
        }

        await writeAudit(tx, {
          eventType:
            target === "active"
              ? AuditEvent.UserActivated
              : AuditEvent.UserDeactivated,
          result: AuditResult.Success,
          actorId: request.admin.userId,
          userId: request.params.id,
          ipAddress: request.ip,
          correlationId: request.correlationId,
        });
      });

      setFlash(reply, target === "active" ? "User activated" : "User deactivated");
      return reply.redirect(`/admin/users/${request.params.id}`);
    },
  );
}
