import {
  AuditEvent,
  AuditResult,
  usersWithPolicyOn,
  withAccessDiff,
  writeAudit,
} from "@gapura/auth-core";
import { hashPassword, randomToken } from "@gapura/crypto";
import type { FastifyInstance } from "fastify";
import { setFlash, takeFlash } from "../flash.js";
import { renderPage } from "../views.js";

interface CreateApplicationBody {
  name?: string;
  client_id?: string;
  launch_url?: string;
  logout_notification_url?: string;
  redirect_uri?: string;
}

export async function registerApplicationRoutes(
  app: FastifyInstance,
): Promise<void> {
  const { prisma } = app.ctx;

  app.get("/admin/applications", async (request, reply) => {
    const applications = await prisma.application.findMany({
      select: {
        id: true,
        name: true,
        clientId: true,
        status: true,
        launchUrl: true,
        _count: { select: { redirectUris: true, policies: true } },
      },
      orderBy: { name: "asc" },
    });

    return reply.type("text/html; charset=utf-8").send(
      renderPage(
        "applications",
        { applications },
        {
          title: "Applications",
          currentUser: request.admin.user,
          activeNav: "applications",
          flash: takeFlash(request, reply),
        },
      ),
    );
  });

  app.post<{ Body: CreateApplicationBody }>(
    "/admin/applications",
    async (request, reply) => {
      const name = (request.body.name ?? "").trim();
      const clientId = (request.body.client_id ?? "").trim();
      const launchUrl = (request.body.launch_url ?? "").trim();
      const logoutUrl = (request.body.logout_notification_url ?? "").trim();
      const redirectUri = (request.body.redirect_uri ?? "").trim();

      if (name === "" || clientId === "" || logoutUrl === "" || redirectUri === "") {
        setFlash(reply, "Name, client id, logout notification URL, and one redirect URI are required");
        return reply.redirect("/admin/applications");
      }

      const existing = await prisma.application.findUnique({
        where: { clientId },
        select: { id: true },
      });
      if (existing !== null) {
        setFlash(reply, "That client id is already registered");
        return reply.redirect("/admin/applications");
      }

      const secret = randomToken();
      const created = await prisma.$transaction(async (tx) => {
        const application = await tx.application.create({
          data: {
            name,
            clientId,
            clientSecretHash: await hashPassword(secret),
            launchUrl: launchUrl === "" ? null : launchUrl,
            logoutNotificationUrl: logoutUrl,
            redirectUris: { create: [{ redirectUri }] },
          },
          select: { id: true },
        });
        await writeAudit(tx, {
          eventType: AuditEvent.ApplicationCreated,
          result: AuditResult.Success,
          actorId: request.admin.userId,
          applicationId: application.id,
          ipAddress: request.ip,
          correlationId: request.correlationId,
          metadata: { clientId },
        });
        return application;
      });

      return reply.type("text/html; charset=utf-8").send(
        renderPage(
          "application-secret",
          { name, clientId, secret, applicationId: created.id },
          {
            title: "Application created",
            currentUser: request.admin.user,
            activeNav: "applications",
          },
        ),
      );
    },
  );

  app.get<{ Params: { id: string } }>(
    "/admin/applications/:id",
    async (request, reply) => {
      const application = await prisma.application.findUnique({
        where: { id: request.params.id },
        select: {
          id: true,
          name: true,
          clientId: true,
          status: true,
          launchUrl: true,
          logoutNotificationUrl: true,
          redirectUris: {
            select: { id: true, redirectUri: true },
            orderBy: { createdAt: "asc" },
          },
          policies: {
            select: {
              id: true,
              effect: true,
              group: { select: { id: true, name: true } },
            },
          },
        },
      });

      if (application === null) {
        setFlash(reply, "Application not found");
        return reply.redirect("/admin/applications");
      }

      const policyGroupIds = new Set(application.policies.map((p) => p.group.id));
      const groups = await prisma.group.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });

      return reply.type("text/html; charset=utf-8").send(
        renderPage(
          "application-detail",
          {
            application,
            availableGroups: groups.filter((g) => !policyGroupIds.has(g.id)),
          },
          {
            title: application.name,
            currentUser: request.admin.user,
            activeNav: "applications",
            flash: takeFlash(request, reply),
          },
        ),
      );
    },
  );

  app.post<{ Params: { id: string } }>(
    "/admin/applications/:id/secret",
    async (request, reply) => {
      const application = await prisma.application.findUnique({
        where: { id: request.params.id },
        select: { id: true, name: true, clientId: true },
      });
      if (application === null) {
        setFlash(reply, "Application not found");
        return reply.redirect("/admin/applications");
      }

      const secret = randomToken();
      await prisma.$transaction(async (tx) => {
        await tx.application.update({
          where: { id: application.id },
          data: { clientSecretHash: await hashPassword(secret) },
        });
        await writeAudit(tx, {
          eventType: AuditEvent.ApplicationSecretRotated,
          result: AuditResult.Success,
          actorId: request.admin.userId,
          applicationId: application.id,
          ipAddress: request.ip,
          correlationId: request.correlationId,
        });
      });

      return reply.type("text/html; charset=utf-8").send(
        renderPage(
          "application-secret",
          {
            name: application.name,
            clientId: application.clientId,
            secret,
            applicationId: application.id,
            rotated: true,
          },
          {
            title: "Secret regenerated",
            currentUser: request.admin.user,
            activeNav: "applications",
          },
        ),
      );
    },
  );

  app.post<{ Params: { id: string }; Body: { redirect_uri?: string } }>(
    "/admin/applications/:id/redirect-uris",
    async (request, reply) => {
      const redirectUri = (request.body.redirect_uri ?? "").trim();
      if (redirectUri === "") {
        setFlash(reply, "Redirect URI is required");
        return reply.redirect(`/admin/applications/${request.params.id}`);
      }

      await prisma.applicationRedirectUri.upsert({
        where: {
          applicationId_redirectUri: {
            applicationId: request.params.id,
            redirectUri,
          },
        },
        update: {},
        create: { applicationId: request.params.id, redirectUri },
      });
      await writeAudit(prisma, {
        eventType: AuditEvent.ApplicationUpdated,
        result: AuditResult.Success,
        actorId: request.admin.userId,
        applicationId: request.params.id,
        ipAddress: request.ip,
        correlationId: request.correlationId,
        metadata: { added: "redirect_uri" },
      });

      setFlash(reply, "Redirect URI added");
      return reply.redirect(`/admin/applications/${request.params.id}`);
    },
  );

  app.post<{ Params: { id: string; uriId: string } }>(
    "/admin/applications/:id/redirect-uris/:uriId/delete",
    async (request, reply) => {
      await prisma.applicationRedirectUri.deleteMany({
        where: { id: request.params.uriId, applicationId: request.params.id },
      });
      await writeAudit(prisma, {
        eventType: AuditEvent.ApplicationUpdated,
        result: AuditResult.Success,
        actorId: request.admin.userId,
        applicationId: request.params.id,
        ipAddress: request.ip,
        correlationId: request.correlationId,
        metadata: { removed: "redirect_uri" },
      });

      setFlash(reply, "Redirect URI removed");
      return reply.redirect(`/admin/applications/${request.params.id}`);
    },
  );

  app.post<{ Params: { id: string }; Body: { status?: string } }>(
    "/admin/applications/:id/status",
    async (request, reply) => {
      const target = request.body.status === "active" ? "active" : "inactive";

      await prisma.$transaction(async (tx) => {
        const affected = await usersWithPolicyOn(tx, request.params.id);
        await withAccessDiff(
          tx,
          { userIds: affected, correlationId: request.correlationId },
          async () => {
            await tx.application.update({
              where: { id: request.params.id },
              data: { status: target },
            });
          },
        );
        await writeAudit(tx, {
          eventType: AuditEvent.ApplicationUpdated,
          result: AuditResult.Success,
          actorId: request.admin.userId,
          applicationId: request.params.id,
          ipAddress: request.ip,
          correlationId: request.correlationId,
          metadata: { status: target },
        });
      });

      setFlash(reply, target === "active" ? "Application activated" : "Application deactivated");
      return reply.redirect(`/admin/applications/${request.params.id}`);
    },
  );
}
