# AniBT OIDC workspace

FontInAss uses AniBT as its identity and subtitle-group authorization source. This document records the internal module boundaries without containing deployment identities, user identifiers, Client secrets, signing keys, Session values or programmatic credentials.

## Trust boundaries

| Surface | Authentication | Accepted routes | Rejected credentials |
| --- | --- | --- | --- |
| Public | none | subset, constrained font contribution, published archives, health | none required |
| Browser workspace | `__Host-fontinass_session` plus CSRF on mutations | `/api/auth/*`, `/api/workspace/*`, `/api/admin/*` | Authorization Bearer, legacy API headers, operator header |
| Programmatic | scoped `Authorization: Bearer fia_…` | `/api/v1/*` | Cookie, legacy API headers, operator header |
| Operator | `X-FontInAss-Operator-Credential` | exact `/api/operator/health` | Cookie, Authorization Bearer, legacy API headers |

The browser never receives the OIDC Client secret, entitlement signing secret, Session protection keys or operator credential.

## Login sequence

1. The browser requests `/api/auth/login` with a local return path.
2. FontInAss creates a bounded, single-use login transaction containing encrypted nonce and PKCE verifier plus a keyed state fingerprint.
3. AniBT completes Authorization Code + PKCE S256.
4. FontInAss validates the ID Token, issuer, audience, expiry, issued-at, nonce and UserInfo subject.
5. FontInAss requires the namespaced AniBT stable user ID and queries the exact signed entitlement route.
6. Only an active account with at least one active subtitle-group membership or `fontinass.manage` receives a rotated local Session.
7. Every Session and programmatic request refreshes current entitlement and fails closed when membership or account state changes.

## Local ownership

SQLite owns OIDC identity projections, login transactions, local Sessions, programmatic credentials, organization archive attribution, creation-rate state and bounded access receipts. AniBT remains authoritative for users, account state, subtitle groups, memberships and the `fontinass.manage` grant.

Plaintext secrets are never persisted. Programmatic credentials retain only prefix, suffix, generation, keyed fingerprint, scopes, owner, organization and timestamps. Access receipts use keyed actor/resource fingerprints.

## Migration and rollback

SQLite v3 widens the existing database in place. Legacy access credentials are disabled before the new workspace is enabled, and their historical upload rows are copied to redacted receipts. Old application/review/claim routes and services are absent.

Rollback floor: the pre-v3 image can still read its original tables, but v2 credentials remain revoked after migration. Rolling back authentication therefore restores only public functionality until a forward v3 deploy is completed; do not re-enable legacy credentials.

## Incident actions

- Suspend a member by changing the authoritative AniBT account or subtitle-group membership; FontInAss fails closed on the next request.
- Revoke one programmatic credential from the owner workspace or the administrator credential list.
- Revoke only `fontinass.manage` through the private AniBT permission operation; do not change the user's global role.
- Rotate a lost OIDC Client secret or entitlement signing credential in the respective server-only stores, then redeploy. Never retry a lost one-time programmatic credential response; create a new credential instead.
- Inspect only redacted receipts and low-cardinality logs. Do not add request headers, callback queries, Cookies or raw identity values to logs.
