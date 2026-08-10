import { EventType, RevokeReason } from "@gapura/contracts";
import { pairKey, reachableAccess, type AccessPair } from "./access.js";
import type { Tx } from "./client.js";
import { emitEvent } from "./outbox.js";

export interface DiffOptions {

  userIds?: string[] | undefined;
  correlationId?: string | undefined;
}

/**
 * Runs a mutation and emits one AccessPolicyChanged per (user, application)
 * pair that was reachable before and is not reachable after.
 */
export async function withAccessDiff<T>(
  tx: Tx,
  options: DiffOptions,
  mutate: () => Promise<T>,
): Promise<{ result: T; revoked: AccessPair[] }> {
  const before = await reachableAccess(tx, options.userIds);
  const result = await mutate();
  const after = await reachableAccess(tx, options.userIds);

  const stillReachable = new Set(after.map(pairKey));
  const revoked = before.filter((pair) => !stillReachable.has(pairKey(pair)));

  for (const pair of revoked) {
    await emitEvent(tx, {
      eventType: EventType.AccessPolicyChanged,
      userId: pair.userId,
      applicationId: pair.applicationId,
      reason: RevokeReason.AccessRevoked,
      correlationId: options.correlationId,
    });
  }

  return { result, revoked };
}

export async function membersOfGroup(tx: Tx, groupId: string): Promise<string[]> {
  const rows = await tx.userGroup.findMany({
    where: { groupId },
    select: { userId: true },
  });
  return rows.map((row) => row.userId);
}

export async function usersWithPolicyOn(
  tx: Tx,
  applicationId: string,
): Promise<string[]> {
  const rows = await tx.userGroup.findMany({
    where: { group: { policies: { some: { applicationId } } } },
    select: { userId: true },
    distinct: ["userId"],
  });
  return rows.map((row) => row.userId);
}
