# ChatGPT integration architecture

This document describes the current Add-to-Cart architecture and a proposed, security-conscious integration with ChatGPT. The integration is proposed only: this repository currently contains no OAuth server, backend API, MCP server, or ChatGPT-specific infrastructure.

## 1. Current architecture

The web application is a Vite-served browser client. `index.js` initializes Firebase with the web configuration for project `shopping-list-d3a29`, then creates Firebase Authentication and a Firebase Realtime Database client.

Authentication currently supports:

- email/password account creation and sign-in;
- Google popup sign-in;
- GitHub popup sign-in; and
- Facebook popup sign-in.

`onAuthStateChanged` controls the UI. When a user is signed in, the client uses the Firebase Auth UID to address `users/{uid}/shoppingList`. It subscribes with a Realtime Database listener, renders each child, appends items with `push`, and removes an item by its generated child key after a double-click. The browser therefore accesses Firebase directly; there is no application backend in the current code.

The existing data shape is intentionally small:

```json
{
  "users": {
    "<firebase-uid>": {
      "shoppingList": {
        "<generated-key>": "milk"
      }
    }
  }
}
```

The Realtime Database rules deny access by default and allow read/write only when `auth != null && auth.uid === $uid` at the user shopping-list path. The Firebase web configuration and API key in the client are not server credentials; Firebase security rules remain the authorization boundary for this direct client access. No Firebase Admin credential is present in this repository and none should be put in the browser or in this document.

The current UI does not validate item content before calling `push`, and the database rules do not currently impose item length or type validation. Those are existing characteristics, not recommendations for the integration.

## 2. Proposed architecture: protected API plus MCP

Add a separately deployed backend service between ChatGPT and Firebase:

```text
ChatGPT / MCP client
        │ HTTPS + OAuth access token
        ▼
Protected Add-to-Cart API
        │ verifies token, resolves Firebase UID,
        │ validates input, applies authorization
        ▼
Firebase Admin SDK / Realtime Database
        │
        └── users/{firebaseUid}/shoppingList
```

The backend should be the only component that uses a Firebase Admin credential. It must keep that credential in a secret manager or equivalent server-side environment, never return it to ChatGPT, and never expose it to the browser. The backend should use the Admin SDK only for the narrow operations required by the API and should not provide arbitrary database paths or query expressions to callers.

MCP should expose narrowly scoped tools backed by the API, rather than direct Firebase access. A minimal initial surface could be:

- `get_shopping_list` — read the authenticated user’s list;
- `add_shopping_list_item` — add one string item; and
- `remove_shopping_list_item` — remove one item by opaque item ID.

The MCP server must derive the caller identity from the verified request context. Tool arguments must not contain a caller-supplied Firebase UID, and a prompt or tool argument must never be treated as authorization.

## 3. OAuth authorization and Firebase UID mapping

OAuth infrastructure does not currently exist and must be selected and implemented. The preferred flow is authorization-code flow with PKCE where supported, with exact redirect URI registration, state checking, and CSRF protection. The authorization screen should request only the scopes needed for shopping-list access and should clearly tell the user what ChatGPT can read and change.

The backend should maintain an explicit server-side subject mapping, for example:

```text
oauth_issuer + oauth_subject  →  firebase_uid
```

The mapping must be created only after the user has authenticated and explicitly authorized the integration. It must not map by email alone: email can be absent, change, or be shared across identity providers. If the selected OAuth provider already represents the same Firebase account, account linking must follow Firebase’s supported, authenticated linking flow; otherwise the integration should require an intentional account-selection or linking step.

On each API request, the backend must verify the access token’s signature or introspect it with the authorization server, then check issuer, audience, expiry, not-before, scopes, and any required client binding. It resolves the verified OAuth subject through the server-side mapping and uses only the resulting Firebase UID for database access.

The API should return a generic authorization failure when the mapping is absent rather than revealing whether a Firebase account exists. Administrative account linking, unlinking, and recovery should be separate authenticated operations and should be auditable.

## 4. API and data contracts

The existing database stores strings, so the public contract should preserve string values while exposing generated database keys as opaque IDs.

All endpoints are versioned and require `Authorization: Bearer <access-token>` over HTTPS. Example contract:

### Read

`GET /v1/shopping-list`

Response `200`:

```json
{
  "items": [
    { "id": "-Oabc123", "value": "milk" },
    { "id": "-Odef456", "value": "bread" }
  ]
}
```

`id` is an opaque, server-returned identifier corresponding to the Realtime Database child key. Clients must not construct paths from it. Ordering should be documented (for example, Realtime Database key order or an explicitly defined order).

### Add

`POST /v1/shopping-list`

Request:

```json
{ "value": "milk" }
```

Response `201`:

```json
{ "item": { "id": "-Oabc123", "value": "milk" } }
```

The backend should define maximum length, whitespace normalization, empty-string behavior, Unicode handling, and whether duplicate values are allowed. To make retries safe, a future version may accept an idempotency key; this is preferable to silently creating duplicate items after a timeout.

### Remove

`DELETE /v1/shopping-list/{itemId}`

Response `204` on successful removal. The backend must treat `itemId` as data, validate its format or look it up safely, and verify that it belongs to the authenticated user before deleting. It must never accept a Firebase path or UID in place of this opaque ID.

Suggested error envelope:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "The shopping-list item is invalid."
  },
  "requestId": "..."
}
```

Use stable machine-readable codes and non-sensitive messages. Recommended status meanings include `400` for malformed input, `401` for missing/invalid/expired credentials, `403` for insufficient scope, `404` for an item not visible to the caller, `409` for a documented conflict, `429` for rate limiting, and `5xx` for unexpected service or Firebase failures.

## 5. Token lifecycle and least privilege

Access tokens should be short-lived and scoped to the integration, for example separate read and write scopes such as `shopping_list:read` and `shopping_list:write`. The MCP read tool must require only the read scope; add/remove must require the corresponding write scope. Do not grant a general Firebase or database-admin scope.

Refresh tokens, if issued, must be kept server-side or in the platform’s protected token store, encrypted at rest, restricted to the intended client, and never placed in prompts, MCP tool results, logs, URLs, or browser storage. Access tokens must be sent only over HTTPS and should not be logged. The backend should validate expiration on every request and reject tokens outside their allowed time window.

Revocation must be supported for user disconnect, refresh-token rotation failure, suspected compromise, account unlinking, provider revocation, and Firebase account disablement. The service should revoke or delete stored grants, invalidate cached authorization decisions promptly, and return `401` after revocation. A user should be able to view and disconnect the ChatGPT integration without deleting the shopping list.

Token rotation, replay detection where practical, rate limits per subject/client/IP, bounded request sizes, and audit records for reads, additions, removals, authorization changes, and failures should be part of the implementation design. Audit records must avoid raw tokens and unnecessary shopping-list contents.

## 6. Validation, errors, and security risks

The backend must validate JSON content type, body size, required fields, string type, Unicode-safe length, and normalization policy before writing. It should reject control characters or other disallowed content if the product decides they are not useful. It should apply timeouts and bounded retries to Firebase calls and avoid retrying non-idempotent writes unless an idempotency mechanism is present.

Important risks and controls include:

- **Broken object-level authorization:** always derive UID from the verified token and check item ownership server-side; never trust UID or path arguments.
- **Token leakage:** redact authorization headers and token-like values from application, proxy, tracing, and MCP logs.
- **Prompt injection or confused-deputy behavior:** treat tool arguments and retrieved list values as untrusted data; MCP must not broaden scopes or authorize actions based on natural-language instructions.
- **Accidental destructive actions:** require an explicit tool call for removal, return a clear item preview where the client supports it, and consider confirmation policy for bulk or ambiguous requests. The initial API should not include bulk delete.
- **CSRF and OAuth mix-up:** use state, PKCE, exact redirect URIs, issuer/audience checks, and do not accept tokens in query strings.
- **Enumeration and data disclosure:** use opaque IDs, generic authorization errors, least-privilege responses, and avoid returning other users’ existence or metadata.
- **Abuse and denial of service:** enforce quotas, rate limits, request limits, timeouts, and monitoring.
- **Secrets and supply chain:** keep Firebase Admin credentials and OAuth client secrets out of source control; pin and review backend/MCP dependencies.
- **Data privacy:** minimize retained list data, define retention and deletion behavior, and ensure support/debug tooling does not expose personal shopping data.

## 7. Testing and follow-up issues

Testing should cover unit, integration, security, and operational behavior:

- token verification for valid, expired, wrong-audience, wrong-issuer, malformed, revoked, and insufficient-scope tokens;
- OAuth state/PKCE failures, callback replay, unlinking, refresh rotation, and account-linking edge cases;
- Firebase UID mapping isolation, including attempts to substitute another UID or item ID;
- contract tests for successful reads, additions, removals, validation failures, conflicts, rate limits, and Firebase outages;
- property/fuzz tests for malformed JSON, oversized strings, Unicode, control characters, and path-like input;
- MCP tests proving tools expose only the intended operations and cannot access arbitrary Firebase paths;
- end-to-end tests against a non-production Firebase project with disposable users; and
- logging, alerting, secret-redaction, revocation, and recovery tests.

Small implementation follow-up issues:

1. Decide the OAuth authorization server and ChatGPT/MCP hosting model.
2. Define the consent UX, scopes, redirect URIs, and account-linking/unlinking flow.
3. Implement the server-side OAuth subject-to-Firebase-UID mapping and grant lifecycle.
4. Implement the versioned backend API with validation, authorization, rate limits, and audit events.
5. Add a server-side Firebase Admin integration using secret-managed credentials.
6. Implement the MCP server/tools as a thin, authenticated adapter to the API.
7. Add contract, security, and end-to-end tests and document deployment/incident procedures.
8. Decide whether existing direct browser Firebase access remains alongside the API and whether shared validation/rules should be strengthened separately.

## Unresolved architectural decisions

The repository does not establish the OAuth provider, MCP transport/hosting, deployment platform, consent and account-linking UX, token store, exact scopes, rate limits, item validation policy, ordering guarantees, idempotency policy, audit-log retention, or whether ChatGPT should be read-only by default. These choices should be resolved before implementation. They are intentionally recorded as open decisions rather than inferred from the current Firebase client.
