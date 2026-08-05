import { ADMIN_GROUP_NAME } from "./access.js";
import { createPrismaClient } from "./client.js";
import { hashPassword } from "@gapura/crypto";
import { required } from "./env.js";

async function main(): Promise<void> {
  const prisma = createPrismaClient(required("DATABASE_URL"));

  const adminEmail = required("SEED_ADMIN_EMAIL");
  const adminName = required("SEED_ADMIN_NAME");
  const adminPassword = required("SEED_ADMIN_PASSWORD");
  const keratonBase = required("KERATON_BASE_URL");
  const jogloBase = required("JOGLO_BASE_URL");

  const apps = [
    {
      name: "Keraton",
      clientId: required("KERATON_CLIENT_ID"),
      secret: required("KERATON_CLIENT_SECRET"),
      base: keratonBase,
      groupName: "keraton-users",
      groupDescription: "Dalem Penghuni Keraton",
    },
    {
      name: "Joglo",
      clientId: required("JOGLO_CLIENT_ID"),
      secret: required("JOGLO_CLIENT_SECRET"),
      base: jogloBase,
      groupName: "joglo-users",
      groupDescription: "Rakyat Joglo Jelata",
    },
  ];

  await prisma.$transaction(async (tx) => {
    const administrators = await tx.group.upsert({
      where: { name: ADMIN_GROUP_NAME },
      update: {},
      create: {
        name: ADMIN_GROUP_NAME,
        description: "Control panel atmint grup",
      },
    });

    const existing = await tx.user.findUnique({
      where: { email: adminEmail },
      select: { id: true },
    });

    const admin =
      existing ??
      (await tx.user.create({
        data: {
          name: adminName,
          email: adminEmail,
          passwordHash: await hashPassword(adminPassword),
        },
        select: { id: true },
      }));

    await tx.userGroup.upsert({
      where: { userId_groupId: { userId: admin.id, groupId: administrators.id } },
      update: {},
      create: { userId: admin.id, groupId: administrators.id },
    });

    for (const app of apps) {
      const group = await tx.group.upsert({
        where: { name: app.groupName },
        update: {},
        create: { name: app.groupName, description: app.groupDescription },
      });

      const application = await tx.application.upsert({
        where: { clientId: app.clientId },
        update: {
          launchUrl: app.base,
          logoutNotificationUrl: `${app.base}/internal/logout`,
        },
        create: {
          name: app.name,
          clientId: app.clientId,
          clientSecretHash: await hashPassword(app.secret),
          launchUrl: app.base,
          logoutNotificationUrl: `${app.base}/internal/logout`,
        },
        select: { id: true },
      });

      const redirectUri = `${app.base}/callback`;
      await tx.applicationRedirectUri.upsert({
        where: {
          applicationId_redirectUri: {
            applicationId: application.id,
            redirectUri,
          },
        },
        update: {},
        create: { applicationId: application.id, redirectUri },
      });

      for (const groupId of [group.id]) {
        await tx.applicationGroupPolicy.upsert({
          where: {
            applicationId_groupId_effect: {
              applicationId: application.id,
              groupId,
              effect: "allow",
            },
          },
          update: {},
          create: { applicationId: application.id, groupId, effect: "allow" },
        });
      }

      await tx.userGroup.upsert({
        where: { userId_groupId: { userId: admin.id, groupId: group.id } },
        update: {},
        create: { userId: admin.id, groupId: group.id },
      });
    }
  });

  const counts = {
    users: await prisma.user.count(),
    groups: await prisma.group.count(),
    applications: await prisma.application.count(),
    policies: await prisma.applicationGroupPolicy.count(),
  };
  console.log("Seeding complete: ", counts);

  await prisma.$disconnect();
}

await main();
