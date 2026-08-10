import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createPrismaClient, type PrismaClient, type Tx } from "./client.js";
import { withAccessDiff, membersOfGroup, usersWithPolicyOn } from "./policy-diff.js";

const url = process.env["DATABASE_URL"];
if (url === undefined) throw new Error("DATABASE_URL required for these tests");

let prisma: PrismaClient;

before(() => {
  prisma = createPrismaClient(url);
});

after(async () => {
  await prisma.$disconnect();
});

interface Fixture {
  userA: string;
  userB: string;
  groupOne: string;
  groupTwo: string;
  appX: string;
  appY: string;
}

/**
 * Every case runs inside a transaction that is rolled back, so the tests share
 * one database with the running stack without disturbing it.
 */
async function inRollback(
  body: (tx: Tx, fx: Fixture) => Promise<void>,
): Promise<void> {
  const marker = `diff-${Math.random().toString(36).slice(2, 10)}`;
  await prisma
    .$transaction(async (tx) => {
      const mk = async (name: string): Promise<string> =>
        (
          await tx.user.create({
            data: {
              name,
              email: `${marker}-${name}@test.invalid`,
              passwordHash: "x",
            },
            select: { id: true },
          })
        ).id;
      const mkGroup = async (name: string): Promise<string> =>
        (
          await tx.group.create({
            data: { name: `${marker}-${name}` },
            select: { id: true },
          })
        ).id;
      const mkApp = async (name: string): Promise<string> =>
        (
          await tx.application.create({
            data: {
              name,
              clientId: `${marker}-${name}`,
              logoutNotificationUrl: "http://test.invalid/internal/logout",
            },
            select: { id: true },
          })
        ).id;

      const fx: Fixture = {
        userA: await mk("a"),
        userB: await mk("b"),
        groupOne: await mkGroup("one"),
        groupTwo: await mkGroup("two"),
        appX: await mkApp("x"),
        appY: await mkApp("y"),
      };

      await body(tx, fx);
      throw new Error("__rollback__");
    })
    .catch((error: unknown) => {
      if (error instanceof Error && error.message === "__rollback__") return;
      throw error;
    });
}

const emittedFor = async (tx: Tx, userId: string): Promise<string[]> => {
  const rows = await tx.event.findMany({
    where: { userId, eventType: "AccessPolicyChanged" },
    select: { applicationId: true },
  });
  return rows.map((r) => r.applicationId ?? "null").sort();
};

describe("AccessPolicyChanged snapshot diff", () => {
  test("emits when the last path to an application is removed", async () => {
    await inRollback(async (tx, fx) => {
      await tx.userGroup.create({ data: { userId: fx.userA, groupId: fx.groupOne } });
      await tx.applicationGroupPolicy.create({
        data: { applicationId: fx.appX, groupId: fx.groupOne, effect: "allow" },
      });

      const { revoked } = await withAccessDiff(tx, { userIds: [fx.userA] }, async () => {
        await tx.userGroup.deleteMany({ where: { userId: fx.userA, groupId: fx.groupOne } });
      });

      assert.deepEqual(revoked, [{ userId: fx.userA, applicationId: fx.appX }]);
      assert.deepEqual(await emittedFor(tx, fx.userA), [fx.appX]);
    });
  });

  test("emits nothing when a second group still grants access", async () => {
    await inRollback(async (tx, fx) => {
      await tx.userGroup.create({ data: { userId: fx.userA, groupId: fx.groupOne } });
      await tx.userGroup.create({ data: { userId: fx.userA, groupId: fx.groupTwo } });
      await tx.applicationGroupPolicy.create({
        data: { applicationId: fx.appX, groupId: fx.groupOne, effect: "allow" },
      });
      await tx.applicationGroupPolicy.create({
        data: { applicationId: fx.appX, groupId: fx.groupTwo, effect: "allow" },
      });

      const { revoked } = await withAccessDiff(tx, { userIds: [fx.userA] }, async () => {
        await tx.userGroup.deleteMany({ where: { userId: fx.userA, groupId: fx.groupOne } });
      });

      assert.deepEqual(revoked, []);
      assert.deepEqual(await emittedFor(tx, fx.userA), []);
    });
  });

  test("emits nothing when access is granted rather than removed", async () => {
    await inRollback(async (tx, fx) => {
      await tx.applicationGroupPolicy.create({
        data: { applicationId: fx.appX, groupId: fx.groupOne, effect: "allow" },
      });

      const { revoked } = await withAccessDiff(tx, { userIds: [fx.userA] }, async () => {
        await tx.userGroup.create({ data: { userId: fx.userA, groupId: fx.groupOne } });
      });

      assert.deepEqual(revoked, []);
      assert.deepEqual(await emittedFor(tx, fx.userA), []);
    });
  });

  test("removing one policy revokes only that application", async () => {
    await inRollback(async (tx, fx) => {
      await tx.userGroup.create({ data: { userId: fx.userA, groupId: fx.groupOne } });
      await tx.applicationGroupPolicy.create({
        data: { applicationId: fx.appX, groupId: fx.groupOne, effect: "allow" },
      });
      await tx.applicationGroupPolicy.create({
        data: { applicationId: fx.appY, groupId: fx.groupOne, effect: "allow" },
      });

      await withAccessDiff(tx, { userIds: [fx.userA] }, async () => {
        await tx.applicationGroupPolicy.deleteMany({
          where: { applicationId: fx.appX, groupId: fx.groupOne },
        });
      });

      assert.deepEqual(await emittedFor(tx, fx.userA), [fx.appX]);
    });
  });

  test("one policy removal emits once per affected user", async () => {
    await inRollback(async (tx, fx) => {
      await tx.userGroup.create({ data: { userId: fx.userA, groupId: fx.groupOne } });
      await tx.userGroup.create({ data: { userId: fx.userB, groupId: fx.groupOne } });
      await tx.applicationGroupPolicy.create({
        data: { applicationId: fx.appX, groupId: fx.groupOne, effect: "allow" },
      });

      const affected = await usersWithPolicyOn(tx, fx.appX);
      const { revoked } = await withAccessDiff(tx, { userIds: affected }, async () => {
        await tx.applicationGroupPolicy.deleteMany({ where: { applicationId: fx.appX } });
      });

      assert.equal(revoked.length, 2);
      assert.deepEqual(await emittedFor(tx, fx.userA), [fx.appX]);
      assert.deepEqual(await emittedFor(tx, fx.userB), [fx.appX]);
    });
  });

  test("deleting a group revokes access for all its members", async () => {
    await inRollback(async (tx, fx) => {
      await tx.userGroup.create({ data: { userId: fx.userA, groupId: fx.groupOne } });
      await tx.userGroup.create({ data: { userId: fx.userB, groupId: fx.groupOne } });
      await tx.applicationGroupPolicy.create({
        data: { applicationId: fx.appX, groupId: fx.groupOne, effect: "allow" },
      });

      const affected = await membersOfGroup(tx, fx.groupOne);
      const { revoked } = await withAccessDiff(tx, { userIds: affected }, async () => {
        await tx.group.delete({ where: { id: fx.groupOne } });
      });

      assert.equal(revoked.length, 2);
    });
  });

  test("deactivating an application revokes it for everyone", async () => {
    await inRollback(async (tx, fx) => {
      await tx.userGroup.create({ data: { userId: fx.userA, groupId: fx.groupOne } });
      await tx.applicationGroupPolicy.create({
        data: { applicationId: fx.appX, groupId: fx.groupOne, effect: "allow" },
      });

      const affected = await usersWithPolicyOn(tx, fx.appX);
      const { revoked } = await withAccessDiff(tx, { userIds: affected }, async () => {
        await tx.application.update({
          where: { id: fx.appX },
          data: { status: "inactive" },
        });
      });

      assert.deepEqual(revoked, [{ userId: fx.userA, applicationId: fx.appX }]);
    });
  });

  test("reactivating an application emits nothing", async () => {
    await inRollback(async (tx, fx) => {
      await tx.userGroup.create({ data: { userId: fx.userA, groupId: fx.groupOne } });
      await tx.applicationGroupPolicy.create({
        data: { applicationId: fx.appX, groupId: fx.groupOne, effect: "allow" },
      });
      await tx.application.update({
        where: { id: fx.appX },
        data: { status: "inactive" },
      });

      const { revoked } = await withAccessDiff(tx, { userIds: [fx.userA] }, async () => {
        await tx.application.update({
          where: { id: fx.appX },
          data: { status: "active" },
        });
      });

      assert.deepEqual(revoked, []);
    });
  });

  test("emitted events carry applicationId and never a session id", async () => {
    await inRollback(async (tx, fx) => {
      await tx.userGroup.create({ data: { userId: fx.userA, groupId: fx.groupOne } });
      await tx.applicationGroupPolicy.create({
        data: { applicationId: fx.appX, groupId: fx.groupOne, effect: "allow" },
      });

      await withAccessDiff(
        tx,
        { userIds: [fx.userA], correlationId: "corr-diff" },
        async () => {
          await tx.userGroup.deleteMany({ where: { userId: fx.userA } });
        },
      );

      const row = await tx.event.findFirstOrThrow({
        where: { userId: fx.userA, eventType: "AccessPolicyChanged" },
      });
      assert.equal(row.applicationId, fx.appX);
      assert.equal(row.centralSessionId, null);
      assert.equal(row.status, "pending");

      const payload = row.payload as { metadata: { correlationId: string } };
      assert.equal(payload.metadata.correlationId, "corr-diff");
    });
  });
});
