import type { Tx } from "./client.js";

export const DenialReason = {
  UnknownClient: "unknown_client",
  ApplicationInactive: "application_inactive",
  RedirectUriNotRegistered: "redirect_uri_not_registered",
  UserInactive: "user_inactive",
  NoPolicy: "no_policy",
} as const;
export type DenialReason = (typeof DenialReason)[keyof typeof DenialReason];

export interface EvaluatedApplication {
  id: string;
  name: string;
  clientId: string;
  launchUrl: string | null;
}

export type EvaluationResult =
  | { ok: true; application: EvaluatedApplication }
  | { ok: false; reason: DenialReason; application: EvaluatedApplication | null };

export interface EvaluateInput {
  clientId: string;
  redirectUri: string;
  userId: string;
}

export async function evaluateAuthorization(
  tx: Tx,
  input: EvaluateInput,
): Promise<EvaluationResult> {
  const application = await tx.application.findUnique({
    where: { clientId: input.clientId },
    select: {
      id: true,
      name: true,
      clientId: true,
      status: true,
      launchUrl: true,
    },
  });

  if (application === null) {
    return { ok: false, reason: DenialReason.UnknownClient, application: null };
  }

  const summary: EvaluatedApplication = {
    id: application.id,
    name: application.name,
    clientId: application.clientId,
    launchUrl: application.launchUrl,
  };

  if (application.status !== "active") {
    return {
      ok: false,
      reason: DenialReason.ApplicationInactive,
      application: summary,
    };
  }

  const registered = await tx.applicationRedirectUri.findFirst({
    where: { applicationId: application.id, redirectUri: input.redirectUri },
    select: { id: true },
  });
  if (registered === null) {
    return {
      ok: false,
      reason: DenialReason.RedirectUriNotRegistered,
      application: summary,
    };
  }

  const user = await tx.user.findUnique({
    where: { id: input.userId },
    select: { status: true },
  });
  if (user === null || user.status !== "active") {
    return { ok: false, reason: DenialReason.UserInactive, application: summary };
  }

  const policy = await tx.applicationGroupPolicy.findFirst({
    where: {
      applicationId: application.id,
      effect: "allow",
      group: { members: { some: { userId: input.userId } } },
    },
    select: { id: true },
  });
  if (policy === null) {
    return { ok: false, reason: DenialReason.NoPolicy, application: summary };
  }

  return { ok: true, application: summary };
}

export async function isRegisteredRedirectUri(
  tx: Tx,
  applicationId: string,
  redirectUri: string,
): Promise<boolean> {
  const found = await tx.applicationRedirectUri.findFirst({
    where: { applicationId, redirectUri },
    select: { id: true },
  });
  return found !== null;
}
