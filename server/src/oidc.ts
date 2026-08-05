import * as oidc from "openid-client";
import type {
  OidcWorkspaceIdentity,
  WorkspacePrincipal,
} from "@fontinass/contracts";
import type { WorkspaceAccess } from "@fontinass/access-control";
import type { RuntimeConfig } from "./runtime.js";

const STABLE_USER_ID_CLAIM = "https://anibt.net/claims/user_id";

export class OidcBffError extends Error {
  constructor(
    public readonly code:
      | "configuration"
      | "invalid_callback"
      | "token_exchange_failed"
      | "invalid_identity"
      | "userinfo_failed",
  ) {
    super(code);
    this.name = "OidcBffError";
  }
}

export class OidcBff {
  private discovered:
    | { configuration: oidc.Configuration; expiresAt: number }
    | null = null;

  constructor(
    private readonly config: RuntimeConfig["oidc"],
    private readonly access: WorkspaceAccess,
    private readonly now: () => number = Date.now,
  ) {}

  async authorizationUrl(returnTo: string): Promise<URL> {
    const configuration = await this.configuration();
    const transaction = this.access.beginLogin(returnTo);
    const codeChallenge = await oidc.calculatePKCECodeChallenge(
      transaction.codeVerifier,
    );
    return oidc.buildAuthorizationUrl(configuration, {
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: this.config.scopes,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state: transaction.state,
      nonce: transaction.nonce,
    });
  }

  async callback(currentUrl: URL): Promise<{
    token: string;
    principal: WorkspacePrincipal;
    returnTo: string;
  }> {
    const state = currentUrl.searchParams.get("state")?.trim() ?? "";
    if (!state || state.length > 256) {
      throw new OidcBffError("invalid_callback");
    }
    const transaction = this.access.consumeLogin(state);
    const configuration = await this.configuration();
    const canonicalCallbackUrl = new URL(this.config.redirectUri);
    canonicalCallbackUrl.search = currentUrl.search;

    let tokens: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers;
    try {
      tokens = await oidc.authorizationCodeGrant(configuration, canonicalCallbackUrl, {
        pkceCodeVerifier: transaction.codeVerifier,
        expectedState: state,
        expectedNonce: transaction.nonce,
        idTokenExpected: true,
      });
    } catch {
      throw new OidcBffError("token_exchange_failed");
    }
    const claims = tokens.claims();
    if (!claims || typeof claims.sub !== "string" || !tokens.access_token) {
      throw new OidcBffError("invalid_identity");
    }

    let userInfo: oidc.UserInfoResponse;
    try {
      userInfo = await oidc.fetchUserInfo(
        configuration,
        tokens.access_token,
        claims.sub,
      );
    } catch {
      throw new OidcBffError("userinfo_failed");
    }
    if (userInfo.sub !== claims.sub) {
      throw new OidcBffError("invalid_identity");
    }

    const claimsUserId = claimString(claims, STABLE_USER_ID_CLAIM);
    const userInfoUserId = claimString(userInfo, STABLE_USER_ID_CLAIM);
    const userId = claimsUserId ?? userInfoUserId;
    if (!userId || (claimsUserId && userInfoUserId && claimsUserId !== userInfoUserId)) {
      throw new OidcBffError("invalid_identity");
    }

    const identity: OidcWorkspaceIdentity = {
      issuer: this.config.issuer,
      subject: claims.sub,
      userId,
      displayName:
        claimString(userInfo, "preferred_username") ??
        claimString(userInfo, "name") ??
        claimString(claims, "preferred_username") ??
        claimString(claims, "name") ??
        "AniBT member",
      picture: safePicture(
        claimString(userInfo, "picture") ?? claimString(claims, "picture"),
      ),
    };
    const session = await this.access.establishSession(
      identity,
      typeof tokens.id_token === "string" ? tokens.id_token : null,
    );
    return { ...session, returnTo: transaction.returnTo };
  }

  async endSessionUrl(principal: WorkspacePrincipal): Promise<URL | null> {
    const configuration = await this.configuration();
    try {
      const idToken = this.access.sessionIdToken(principal);
      return oidc.buildEndSessionUrl(configuration, {
        client_id: this.config.clientId,
        post_logout_redirect_uri: this.config.postLogoutRedirectUri,
        ...(idToken ? { id_token_hint: idToken } : {}),
      });
    } catch {
      return null;
    }
  }

  private async configuration(): Promise<oidc.Configuration> {
    if (this.discovered && this.discovered.expiresAt > this.now()) {
      return this.discovered.configuration;
    }
    try {
      const configuration = await oidc.discovery(
        new URL(this.config.issuer),
        this.config.clientId,
        undefined,
        oidc.ClientSecretBasic(this.config.clientSecret),
        new URL(this.config.issuer).protocol === "http:"
          ? { execute: [oidc.allowInsecureRequests] }
          : undefined,
      );
      configuration.timeout = Math.max(1, Math.ceil(this.config.timeoutMs / 1_000));
      this.discovered = {
        configuration,
        expiresAt: this.now() + 10 * 60_000,
      };
      return configuration;
    } catch {
      throw new OidcBffError("configuration");
    }
  }
}

function claimString(
  claims: Record<string, unknown>,
  name: string,
): string | null {
  const value = claims[name];
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 512)
    : null;
}

function safePicture(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
