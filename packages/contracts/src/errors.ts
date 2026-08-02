export const ErrorCode = {
  InvalidRequest: "INVALID_REQUEST",
  InvalidClient: "INVALID_CLIENT",
  InvalidGrant: "INVALID_GRANT",
  InvalidToken: "INVALID_TOKEN",
  InvalidSignature: "INVALID_SIGNATURE",
  AccessDenied: "ACCESS_DENIED",
  Unauthenticated: "UNAUTHENTICATED",
  Forbidden: "FORBIDDEN",
  NotFound: "NOT_FOUND",
  Conflict: "CONFLICT",
  UnsupportedGrantType: "UNSUPPORTED_GRANT_TYPE",
  ServerError: "SERVER_ERROR",
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
  };
}

export function errorBody(
  code: ErrorCode,
  message: string,
  requestId: string,
): ErrorBody {
  return { error: { code, message, requestId } };
}

export const ErrorMessage = {
  InvalidCredentials: "Email or password is incorrect",
  InvalidRequest: "The request is not valid",
  InvalidClient: "Client authentication failed",
  InvalidGrant: "Authorization request is not valid",
  InvalidToken: "The access token is not valid",
  AccessDenied: "You do not have access to this application",
  Unauthenticated: "Sign in to continue",
  Forbidden: "You do not have access to this page",
  NotFound: "Not found",
  ServerError: "Something went wrong",
} as const;

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  [ErrorCode.InvalidRequest]: 400,
  [ErrorCode.InvalidClient]: 401,
  [ErrorCode.InvalidGrant]: 400,
  [ErrorCode.InvalidToken]: 401,
  [ErrorCode.InvalidSignature]: 401,
  [ErrorCode.AccessDenied]: 403,
  [ErrorCode.Unauthenticated]: 401,
  [ErrorCode.Forbidden]: 403,
  [ErrorCode.NotFound]: 404,
  [ErrorCode.Conflict]: 409,
  [ErrorCode.UnsupportedGrantType]: 400,
  [ErrorCode.ServerError]: 500,
};

export function statusForCode(code: ErrorCode): number {
  return STATUS_BY_CODE[code];
}

export class GapuraError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly detail: string | undefined;

  constructor(code: ErrorCode, message: string, detail?: string) {
    super(message);
    this.name = "GapuraError";
    this.code = code;
    this.status = statusForCode(code);
    this.detail = detail;
  }
}
