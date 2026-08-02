export const UserStatus = {
  Active: "active",
  Inactive: "inactive",
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const ApplicationStatus = {
  Active: "active",
  Inactive: "inactive",
} as const;
export type ApplicationStatus = (typeof ApplicationStatus)[keyof typeof ApplicationStatus];

export const SessionStatus = {
  Active: "active",
  Expired: "expired",
  Revoked: "revoked",
} as const;
export type SessionStatus = (typeof SessionStatus)[keyof typeof SessionStatus];

export const TokenStatus = {
  Active: "active",
  Expired: "expired",
  Revoked: "revoked",
} as const;
export type TokenStatus = (typeof TokenStatus)[keyof typeof TokenStatus];

export const PolicyEffect = {
  Allow: "allow",
} as const;
export type PolicyEffect = (typeof PolicyEffect)[keyof typeof PolicyEffect];

export const EventStatus = {
  Pending: "pending",
  Published: "published",
  Failed: "failed",
} as const;
export type EventStatus = (typeof EventStatus)[keyof typeof EventStatus];

export const EventDeliveryStatus = {
  Pending: "pending",
  Processing: "processing",
  Succeeded: "succeeded",
  Retrying: "retrying",
  Failed: "failed",
} as const;
export type EventDeliveryStatus =
  (typeof EventDeliveryStatus)[keyof typeof EventDeliveryStatus];

export const RevokeReason = {
  SsoLogout: "sso_logout",
  LocalLogout: "local_logout",
  PasswordChanged: "password_changed",
  AccessRevoked: "access_revoked",
  UserDeactivated: "user_deactivated",
  Expired: "expired",
} as const;
export type RevokeReason = (typeof RevokeReason)[keyof typeof RevokeReason];
