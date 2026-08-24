# PLAN — Production Reality Sprint (Phases 0, 3, 5)

This plan bridges the gap between the functional prototype and a deployable SaaS by focusing on real infrastructure, authentication, metrics, and OAuth integrations, as recommended in the recent code review.

## Section A — Goal & Acceptance Criteria

- **Technical Restatement:** Replace in-memory mock systems with production-grade infrastructure: PostgreSQL for state, Supabase Auth for sessions, genuine OAuth PKCE flows for third-party integrations (Google Calendar, Todoist), and a privacy-safe local analytics adapter for measuring user retention and gesture success.
- **Observable "Done" Definition:**
  1. The backend relies on a PostgreSQL database instead of `InMemoryWorkspaceRepository`.
  2. Users can log in using Supabase Auth (or similar managed provider); WebSockets and API calls reject unauthenticated traffic.
  3. Google Calendar and Todoist cards connect via a real OAuth PKCE flow; encrypted tokens are stored per user.
  4. Telemetry events flow into a capped `LocalAnalytics` adapter, visible via a developer diagnostics panel.
  5. The Dashboard includes a functional "Was this useful today?" feedback control.
- **Out of Scope:** Team collaboration permissions (Phase 6 features remain tied to basic ownership), billing/Stripe integration, and replacing eye attention.

## Section B — Tech Stack & Constraints

- **Database:** PostgreSQL accessed via `pg` or Prisma/Drizzle (to be determined based on existing backend dependencies; we'll add Prisma or Drizzle for type-safety).
- **Authentication:** Supabase Auth (since Supabase is specified in `INFRASTRUCTURE.md` for PostgreSQL).
- **Integrations:** OAuth 2.0 PKCE flow for Google and Todoist. Tokens will be encrypted before storage.
- **Analytics:** Frontend-only queue (`LocalAnalytics`) using IndexedDB or LocalStorage. No server sink will be introduced.

## Section C — Blocking Questions (0–3) & Assumptions

> [!IMPORTANT]
> Please confirm these assumptions or provide guidance on the blocking questions before we proceed.

**Blocking Questions (1):**
1. **Database ORM:** Which ORM/query builder should I use for the PostgreSQL backend? *(Recommended: Drizzle ORM for its lightweight, TS-first approach and seamless edge compatibility, or standard Prisma).*

**Assumptions:**
1. **[Data]** OAuth credentials (client IDs/secrets) will be provided via `.env` files in development and environment variables in production.
2. **[Boundaries]** `LocalAnalytics` will store max 1000 events locally, overriding the oldest, ensuring no privacy leakage.
3. **[Security]** Refresh tokens are encrypted using a backend secret before being saved in PostgreSQL.

## Section D — Session Modularization

### Session 1: Phase 5 - SaaS Identity & PostgreSQL
- **Objective:** Establish the persistent database and authentication layer.
- **Scope:** `apps/backend/src/state/repository.ts`, Auth API, Supabase connection.
- **Output:** A functional Postgres-backed repository and secure auth middleware.

### Session 2: Phase 3 - Real OAuth & Integrations
- **Objective:** Implement the OAuth PKCE flow and replace mock providers.
- **Scope:** `apps/backend/src/api/oauth.ts`, `apps/frontend/src/utils/integrations/oauth.ts`, Google Calendar/Todoist adapters.
- **Output:** Users can connect their real Calendar and Todoist accounts.

### Session 3: Phase 0 - Metrics & Analytics
- **Objective:** Implement local metrics to evaluate product usage without compromising privacy.
- **Scope:** `packages/shared/src/analytics.ts`, Dashboard feedback UI, Diagnostics query param.
- **Output:** Actionable local dashboards tracking gesture success, failures, and daily utility.

## Section E — Progress Checklist

- [ ] **Session 1: SaaS Identity & PostgreSQL**
  - [ ] Setup ORM/schema.
  - [ ] Implement `PostgresUserRepository` and `PostgresWorkspaceRepository`.
  - [ ] Enforce authentication on WebSocket and HTTP routes.
- [ ] **Session 2: Real OAuth & Integrations**
  - [ ] Implement backend OAuth token exchange/storage.
  - [ ] Implement frontend PKCE flow.
  - [ ] Replace mock Calendar/Todoist with real API clients.
- [ ] **Session 3: Metrics & Analytics**
  - [ ] Build `LocalAnalytics` adapter.
  - [ ] Add "Was this useful?" UI.
  - [ ] Add diagnostics view.
