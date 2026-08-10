import {
  ADMIN_GROUP_NAME,
  AuditEvent,
  AuditResult,
  membersOfGroup,
  withAccessDiff,
  writeAudit,
} from "@gapura/auth-core";
import type { FastifyInstance } from "fastify";
import { setFlash, takeFlash } from "../flash.js";
import { renderPage } from "../views.js";

interface GroupBody {
  name?: string;
  description?: string;
}

export async function registerGroupRoutes(app: FastifyInstance): Promise<void> {
  const { prisma } = app.ctx;

  app.get("/admin/groups", async (request, reply) => {
    const groups = await prisma.group.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        _count: { select: { members: true, policies: true } },
      },
      orderBy: { name: "asc" },
    });

    return reply.type("text/html; charset=utf-8").send(
      renderPage(
        "groups",
        { groups },
        {
          title: "Groups",
          currentUser: request.admin.user,
          activeNav: "groups",
          flash: takeFlash(request, reply),
        },
      ),
    );
  });

  app.post<{ Body: GroupBody }>("/admin/groups", async (request, reply) => {
    const name = (request.body.name ?? "").trim();
    const description = (request.body.description ?? "").trim();

    if (name === "") {
      setFlash(reply, "Group name is required");
      return reply.redirect("/admin/groups");
    }

    const existing = await prisma.group.findUnique({
      where: { name },
      select: { id: true },
    });
    if (existing !== null) {
      setFlash(reply, "A group with that name already exists");
      return reply.redirect("/admin/groups");
    }

    await prisma.$transaction(async (tx) => {
      const group = await tx.group.create({
        data: { name, description: description === "" ? null : description },
        select: { id: true },
      });
      await writeAudit(tx, {
        eventType: AuditEvent.GroupCreated,
        result: AuditResult.Success,
        actorId: request.admin.userId,
        ipAddress: request.ip,
        correlationId: request.correlationId,
        metadata: { groupId: group.id, name },
      });
    });

    setFlash(reply, `Group ${name} created`);
    return reply.redirect("/admin/groups");
  });

  app.get<{ Params: { id: string } }>("/admin/groups/:id", async (request, reply) => {
    const group = await prisma.group.findUnique({
      where: { id: request.params.id },
      select: {
        id: true,
        name: true,
        description: true,
        members: {
          select: { user: { select: { id: true, name: true, email: true, status: true } } },
          orderBy: { user: { name: "asc" } },
        },
        policies: {
          select: { id: true, effect: true, application: { select: { id: true, name: true } } },
        },
      },
    });

    if (group === null) {
      setFlash(reply, "Group not found");
      return reply.redirect("/admin/groups");
    }

    const memberIds = new Set(group.members.map((m) => m.user.id));
    const candidates = await prisma.user.findMany({
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    });

    return reply.type("text/html; charset=utf-8").send(
      renderPage(
        "group-detail",
        { group, candidates: candidates.filter((u) => !memberIds.has(u.id)) },
        {
          title: group.name,
          currentUser: request.admin.user,
          activeNav: "groups",
          flash: takeFlash(request, reply),
        },
      ),
    );
  });

  app.post<{ Params: { id: string } }>(
    "/admin/groups/:id/delete",
    async (request, reply) => {
      const group = await prisma.group.findUnique({
        where: { id: request.params.id },
        select: { id: true, name: true },
      });

      if (group === null) {
        setFlash(reply, "Group not found");
        return reply.redirect("/admin/groups");
      }

      // Prevent default administrators group deletion
      if (group.name === ADMIN_GROUP_NAME) {
        setFlash(reply, "The administrators group cannot be deleted");
        return reply.redirect(`/admin/groups/${group.id}`);
      }

      await prisma.$transaction(async (tx) => {
        const affected = await membersOfGroup(tx, group.id);
        await withAccessDiff(
          tx,
          { userIds: affected, correlationId: request.correlationId },
          async () => {
            await tx.group.delete({ where: { id: group.id } });
          },
        );
        await writeAudit(tx, {
          eventType: AuditEvent.GroupDeleted,
          result: AuditResult.Success,
          actorId: request.admin.userId,
          ipAddress: request.ip,
          correlationId: request.correlationId,
          metadata: { groupId: group.id, name: group.name },
        });
      });

      setFlash(reply, `Group ${group.name} deleted`);
      return reply.redirect("/admin/groups");
    },
  );
}
