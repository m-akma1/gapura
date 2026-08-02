import type { Tx } from "./client.js";

export interface AccessPair {
  userId: string;
  applicationId: string;
}

export function pairKey(pair: AccessPair): string {
  return `${pair.userId}:${pair.applicationId}`;
}

export async function reachableAccess(
  tx: Tx,
  userIds?: string[],
): Promise<AccessPair[]> {
  const rows =
    userIds === undefined
      ? await tx.$queryRaw<AccessPair[]>`
          SELECT DISTINCT ug.user_id AS "userId", agp.application_id AS "applicationId"
          FROM user_groups ug
          JOIN application_group_policies agp ON agp.group_id = ug.group_id
          JOIN applications a ON a.id = agp.application_id
          JOIN users u ON u.id = ug.user_id
          WHERE agp.effect = 'allow'
            AND a.status = 'active'
            AND u.status = 'active'
        `
      : userIds.length === 0
        ? []
        : await tx.$queryRaw<AccessPair[]>`
            SELECT DISTINCT ug.user_id AS "userId", agp.application_id AS "applicationId"
            FROM user_groups ug
            JOIN application_group_policies agp ON agp.group_id = ug.group_id
            JOIN applications a ON a.id = agp.application_id
            JOIN users u ON u.id = ug.user_id
            WHERE agp.effect = 'allow'
              AND a.status = 'active'
              AND u.status = 'active'
              AND ug.user_id = ANY(${userIds}::uuid[])
          `;

  return rows;
}

export async function hasAccess(
  tx: Tx,
  userId: string,
  applicationId: string,
): Promise<boolean> {
  const found = await tx.applicationGroupPolicy.findFirst({
    where: {
      applicationId,
      effect: "allow",
      group: { members: { some: { userId } } },
    },
    select: { id: true },
  });
  return found !== null;
}

export async function groupNamesForUser(tx: Tx, userId: string): Promise<string[]> {
  const memberships = await tx.userGroup.findMany({
    where: { userId },
    select: { group: { select: { name: true } } },
    orderBy: { group: { name: "asc" } },
  });
  return memberships.map((m) => m.group.name);
}

export const ADMIN_GROUP_NAME = "administrators";

export async function isAdministrator(tx: Tx, userId: string): Promise<boolean> {
  const membership = await tx.userGroup.findFirst({
    where: { userId, group: { name: ADMIN_GROUP_NAME } },
    select: { id: true },
  });
  return membership !== null;
}
