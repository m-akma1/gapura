import {
  AuditEvent,
  AuditResult,
  emitEvent,
  membersOfGroup,
  revokeSession,
  usersWithPolicyOn,
  withAccessDiff,
  writeAudit,
} from "@gapura/auth-core";
import { EventType, RevokeReason } from "@gapura/contracts";
import type { FastifyInstance } from "fastify";
import { setFlash } from "../flash.js";

export async function registerMembershipRoutes(
  app: FastifyInstance,
): Promise<void> {
  const { prisma } = app.ctx;

  app.post<{ Params: { id: string }; Body: { group_id?: string } }>(
    "/admin/users/:id/groups",
    async (request, reply) => {
      const groupId = request.body.group_id ?? "";
      if (groupId === "") {
        setFlash(reply, "Select a group");
        return reply.redirect(`/admin/users/${request.params.id}`);
      }

      await prisma.$transaction(async (tx) => {
        await tx.userGroup.upsert({
          where: { userId_groupId: { userId: request.params.id, groupId } },
          update: {},
          create: { userId: request.params.id, groupId },
        });
        await writeAudit(tx, {
          eventType: AuditEvent.GroupMemberAdded,
          result: AuditResult.Success,
          actorId: request.admin.userId,
          userId: request.params.id,
          ipAddress: request.ip,
          correlationId: request.correlationId,
          metadata: { groupId },
        });
      });

      setFlash(reply, "Added to group");
      return reply.redirect(`/admin/users/${request.params.id}`);
    },
  );

  app.post<{ Params: { id: string; groupId: string } }>(
    "/admin/users/:id/groups/:groupId/remove",
    async (request, reply) => {
      await prisma.$transaction(async (tx) => {
        await withAccessDiff(
          tx,
          { userIds: [request.params.id], correlationId: request.correlationId },
          async () => {
            await tx.userGroup.deleteMany({
              where: {
                userId: request.params.id,
                groupId: request.params.groupId,
              },
            });
          },
        );
        await writeAudit(tx, {
          eventType: AuditEvent.GroupMemberRemoved,
          result: AuditResult.Success,
          actorId: request.admin.userId,
          userId: request.params.id,
          ipAddress: request.ip,
          correlationId: request.correlationId,
          metadata: { groupId: request.params.groupId },
        });
      });

      setFlash(reply, "Removed from group");
      return reply.redirect(request.headers.referer ?? `/admin/users/${request.params.id}`);
    },
  );

  app.post<{ Params: { id: string }; Body: { user_id?: string } }>(
    "/admin/groups/:id/members",
    async (request, reply) => {
      const userId = request.body.user_id ?? "";
      if (userId === "") {
        setFlash(reply, "Select a user");
        return reply.redirect(`/admin/groups/${request.params.id}`);
      }

      await prisma.$transaction(async (tx) => {
        await tx.userGroup.upsert({
          where: { userId_groupId: { userId, groupId: request.params.id } },
          update: {},
          create: { userId, groupId: request.params.id },
        });
        await writeAudit(tx, {
          eventType: AuditEvent.GroupMemberAdded,
          result: AuditResult.Success,
          actorId: request.admin.userId,
          userId,
          ipAddress: request.ip,
          correlationId: request.correlationId,
          metadata: { groupId: request.params.id },
        });
      });

      setFlash(reply, "Member added");
      return reply.redirect(`/admin/groups/${request.params.id}`);
    },
  );

  app.post<{ Params: { id: string }; Body: { group_id?: string } }>(
    "/admin/applications/:id/policies",
    async (request, reply) => {
      const groupId = request.body.group_id ?? "";
      if (groupId === "") {
        setFlash(reply, "Select a group");
        return reply.redirect(`/admin/applications/${request.params.id}`);
      }

      await prisma.$transaction(async (tx) => {
        await tx.applicationGroupPolicy.upsert({
          where: {
            applicationId_groupId_effect: {
              applicationId: request.params.id,
              groupId,
              effect: "allow",
            },
          },
          update: {},
          create: {
            applicationId: request.params.id,
            groupId,
            effect: "allow",
          },
        });
        await writeAudit(tx, {
          eventType: AuditEvent.PolicyCreated,
          result: AuditResult.Success,
          actorId: request.admin.userId,
          applicationId: request.params.id,
          ipAddress: request.ip,
          correlationId: request.correlationId,
          metadata: { groupId },
        });
      });

      setFlash(reply, "Access granted");
      return reply.redirect(`/admin/applications/${request.params.id}`);
    },
  );

  app.post<{ Params: { id: string; policyId: string } }>(
    "/admin/applications/:id/policies/:policyId/delete",
    async (request, reply) => {
      await prisma.$transaction(async (tx) => {
        // Snapshot every user who reaches this application through any policy,
        // not just the group being removed: some of them may keep access
        // through a second group, and only the set difference knows which.
        const affected = await usersWithPolicyOn(tx, request.params.id);
        await withAccessDiff(
          tx,
          { userIds: affected, correlationId: request.correlationId },
          async () => {
            await tx.applicationGroupPolicy.deleteMany({
              where: {
                id: request.params.policyId,
                applicationId: request.params.id,
              },
            });
          },
        );
        await writeAudit(tx, {
          eventType: AuditEvent.PolicyDeleted,
          result: AuditResult.Success,
          actorId: request.admin.userId,
          applicationId: request.params.id,
          ipAddress: request.ip,
          correlationId: request.correlationId,
          metadata: { policyId: request.params.policyId },
        });
      });

      setFlash(reply, "Access removed");
      return reply.redirect(`/admin/applications/${request.params.id}`);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/admin/sessions/:id/revoke",
    async (request, reply) => {
      const session = await prisma.ssoSession.findUnique({
        where: { id: request.params.id },
        select: { id: true, userId: true },
      });

      if (session !== null) {
        await prisma.$transaction(async (tx) => {
          const revoked = await revokeSession(
            tx,
            session.id,
            RevokeReason.SsoLogout,
          );
          if (!revoked) return;

          await emitEvent(tx, {
            eventType: EventType.SessionRevoked,
            userId: session.userId,
            centralSessionId: session.id,
            reason: RevokeReason.SsoLogout,
            correlationId: request.correlationId,
          });
          await writeAudit(tx, {
            eventType: AuditEvent.SessionRevoked,
            result: AuditResult.Success,
            actorId: request.admin.userId,
            userId: session.userId,
            sessionId: session.id,
            ipAddress: request.ip,
            correlationId: request.correlationId,
          });
        });
      }

      setFlash(reply, "Session revoked");
      return reply.redirect(request.headers.referer ?? "/admin/users");
    },
  );
}
