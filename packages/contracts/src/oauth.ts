/** Returned by POST /token */
export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  sso_session_id: string;
}

/** Returned by GET /userinfo */
export interface UserInfoResponse {
  sub: string;
  name: string;
  email: string;
  groups: string[];
}

export const AUTHORIZATION_CODE_GRANT = "authorization_code";
