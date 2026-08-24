# Implementation Plan — Phase 5: SaaS Identity, Persistence, and Billing Foundation

## Section A — Goal & Acceptance Criteria

### Technical Restatement
Transition JARVIS from a single-tenant local/demo environment to a secure, multi-tenant SaaS architecture. This includes introducing a typed SaaS data model (`User`, `Workspace`, `WorkspaceCard`, `Layout`, `IntegrationConnection`, `Preference`, `Organization`), a modular repository abstraction with database migration and legacy JSON import support, session/magic-link authentication with tenant-isolated access controls across HTTP and WebSocket channels, plan entitlement checks (`free` vs `pro`), and usage accounting interfaces for AI and integration proxy traffic.

### Observable "Done" Definition
- Multi-tenant isolation: User A cannot read, query, or mutate User B's workspaces or proxy resources via REST or WebSocket.
- Unauthenticated / Guest fallback: Signed-out users can still interact seamlessly in local/offline demo mode without disruption.
- Authentication endpoints (`POST /api/auth/magic-link`, `POST /api/auth/verify`, `GET /api/auth/me`, `POST /api/auth/logout`) issue cryptographically signed session tokens and validate user identity.
- Data migration utility (`importJsonWorkspace`) cleanly imports existing `workspace.json` snapshots into the repository layer.
- Entitlement & Usage tracking: Free tier accounts are limited to 1 workspace; AI and integration proxy calls increment persistent usage ledgers and respect quota gates.
- All automated unit tests and integration tests pass cleanly with zero regressions across frontend and backend.

### Out of Scope
- Live Stripe / Payment gateway webhook processor (the accounting and plan entitlement interfaces are built, but live card charging is stubbed/feature-flagged).
- Production SMTP server integration (magic links use local cryptographically generated verification URLs logged securely in dev/demo).
- Team organization multi-user admin dashboards (deferred to Phase 6 collaboration).

---

## Section B — Tech Stack & Constraints

- **Packages Touched:**
  - `packages/shared`: Data models (`User`, `Workspace`, `WorkspaceCard`, `Layout`, `IntegrationConnection`, `Preference`, `Organization`, `PlanTier`, `Entitlements`, `UsageRecord`), auth message schemas.
  - `apps/backend`: Express auth middleware, session token handling (`crypto`), modular repository layer (`WorkspaceRepository`, `UserRepository`, `UsageRepository`), JSON migration script, tenant-isolated WebSocket connection handler, rate limiters.
  - `apps/frontend`: User auth context / guest state, Auth & Workspace Switcher card, entitlement-aware cloud sync client.
- **Architectural Decisions & Alternatives:**
  - *Auth Mechanism:* Signed, HTTP-only session tokens with HMAC-SHA256 magic links vs OAuth 3rd-party provider SDKs. *Decision:* Built-in lightweight crypto session engine to maintain zero external network dependency in local/test environments while keeping production pluggability.
  - *Persistence Layer:* Repository Pattern with Pluggable Storage Adapter (JSON/Memory/SQL-ready) and Migration Interface vs raw hardcoded ORM. *Decision:* Clean repository interface allowing effortless switching between SQLite/PostgreSQL and standalone test stores without breaking the Express/WS pipeline.

---

## Section C — Blocking Questions & Assumptions

### Blocking Questions (0–3)
- **None (0).** Recommended defaults selected for seamless backward compatibility with existing guest demo modes.

### Falsifiable Assumptions
- `[ASSUMPTION 1: Guest / Offline Mode Compatibility]`: Unauthenticated users without a session token default to an in-memory/localStorage guest workspace and local demo providers without error banners.
- `[ASSUMPTION 2: Session Security]`: Auth tokens and API secrets are never logged in plain text and are redacted in all error traces.
- `[ASSUMPTION 3: Persistence Backward Compatibility]`: Existing local `workspace.json` files can be imported into the new repository structure with zero data loss.
- `[ASSUMPTION 4: Plan Tier Boundaries]`: Free tier allows 1 workspace with local cards; Pro tier unlocks multiple workspaces, cloud synchronization, and AI proxy allowances.

---

## Section D — Session Modularization

### Session 1: Core SaaS Data Models & Shared Types
- **Objective:** Define all entity interfaces, plan tiers, and auth payload shapes in `@jarvis/shared`.
- **Scope:** `packages/shared/src/types.ts`, `packages/shared/src/saas.ts`, `packages/shared/src/index.ts`.
- **Output:** Shared SaaS types and validation helpers with unit tests.

### Session 2: Backend Repository Layer & Migration Engine
- **Objective:** Implement modular repositories (`UserRepository`, `WorkspaceRepository`, `UsageRepository`) and JSON migration utility.
- **Scope:** `apps/backend/src/state/repository.ts`, `apps/backend/src/state/migrations.ts`, `apps/backend/src/state/store.ts`.
- **Output:** Fully testable repository layer with JSON import capabilities and unit tests.

### Session 3: Authentication, Tenant Isolation & Proxy Quotas
- **Objective:** Add magic-link auth endpoints, session middleware, tenant ownership verification, and proxy usage accounting.
- **Scope:** `apps/backend/src/api/auth.ts`, `apps/backend/src/api/http.ts`, `apps/backend/src/websocket/server.ts`.
- **Output:** Secured REST and WebSocket endpoints with multi-tenant isolation tests.

### Session 4: Frontend Auth State & Workspace Switching UI
- **Objective:** Provide visual login/logout, guest fallback handling, and multi-workspace management in the frontend.
- **Scope:** `apps/frontend/src/utils/auth.ts`, `apps/frontend/src/components/apps/AuthCard.tsx`, `apps/frontend/src/components/apps/index.ts`, `apps/frontend/src/App.tsx`.
- **Output:** Complete working SaaS flow in the spatial UI with automated tests and production build verification.

---

## Section E — Progress Checklist

- [ ] Session 1: Core SaaS Data Models & Shared Types
  - [ ] Define `User`, `Workspace`, `Layout`, `Preference`, `PlanTier`, `UsageRecord` in `@jarvis/shared`
  - [ ] Add serialization and type-guard tests in `@jarvis/shared`
- [ ] Session 2: Backend Repository Layer & Migration Engine
  - [ ] Implement `WorkspaceRepository` and `UserRepository` in backend
  - [ ] Implement `importJsonWorkspace` migration helper
  - [ ] Unit tests for repository operations and JSON migration
- [ ] Session 3: Authentication, Tenant Isolation & Proxy Quotas
  - [ ] Implement magic-link session authentication in `apps/backend/src/api/auth.ts`
  - [ ] Enforce tenant isolation on `/api/workspace` and WebSocket connection handshakes
  - [ ] Add usage accounting for AI proxy requests
  - [ ] Unit & integration tests for auth, isolation, and quotas
- [ ] Session 4: Frontend Auth State & Workspace Switching UI
  - [ ] Create `AuthCard.tsx` with magic-link login and plan badge
  - [ ] Add workspace switcher for multi-workspace Pro users
  - [ ] Verify complete test suite and production build
