# JARVIS Production Infrastructure

This document outlines the production architecture for the JARVIS closed beta release. It details the hosting, database, monitoring, and security strategies to ensure a scalable and secure deployment.

## 1. Hosting Architecture

### Frontend (Static/SPA)
- **Provider:** Vercel
- **Why:** Vercel offers seamless deployment for Vite/React applications, automatic SSL, global CDN distribution, and built-in branch preview environments.
- **Build Command:** `npm run build:frontend`
- **Output Directory:** `apps/frontend/dist`

### Backend (Node.js WebSocket Server)
- **Provider:** Fly.io or Render
- **Why:** JARVIS relies heavily on persistent WebSocket connections for real-time collaboration. Vercel's serverless functions are not suited for long-lived WebSocket connections. Fly.io or Render provides persistent containers and built-in load balancing.
- **Scaling Strategy:** We will start with multiple Node instances across a few key regions. We will use Redis Pub/Sub (via Upstash or Render's Redis) to broadcast messages across different backend instances.

## 2. Data Persistence

### Database
- **Provider:** Supabase (Managed PostgreSQL)
- **Why:** Offers a robust relational database with built-in connection pooling (PgBouncer), making it ideal for the server-side repository layer (`state/repository.ts`) developed in Phase 5.
- **Data Stored:** User accounts, Workspaces, WorkspaceCards (Layouts), and Integration Connections.
- **Backups:** Supabase provides daily automated backups (Point-in-Time Recovery enabled for production).

### Secrets Management
- **Method:** Secrets (e.g., Supabase URL, Supabase Service Key, LLM API Keys, JWT Secrets) are managed via the respective hosting platform's environment variable management (Vercel Envs and Fly.io Secrets).
- **Security:** No secrets are committed to the repository. Access to production secrets is restricted to organization admins.

## 3. Telemetry and Error Monitoring

### Operational Monitoring
- **Provider:** Sentry (or DataDog/PostHog depending on final budget decisions).
- **Frontend Tracking:** Latency, UI crashes, unexpected gesture recognition errors.
- **Backend Tracking:** WebSocket connection drops, integration API failures (e.g., Google Calendar timeout), AI provider latency, unhandled exceptions.
- **Privacy Constraints:** 
  - **NO CAMERA DATA** is ever logged or transmitted to telemetry services.
  - **NO RAW USER CONTENT** (e.g., chat messages, note contents) is included in error payloads. Only operational metadata (e.g., "AI request failed with 500") is recorded.
  - Data Retention: Logs and errors are retained for 30 days and then automatically deleted.

## 4. Compliance and Data Regions

- **Data Region:** Database and primary backend instances will be hosted in the US (e.g., AWS `us-east-1` via Supabase/Fly).
- **Data Export & Deletion:** Users have the right to export their workspace data as JSON and permanently delete their accounts via the Settings app, satisfying basic GDPR/CCPA requirements.
- **Camera Data:** Processed entirely on the client side using MediaPipe. Frame data and facial landmarks are never transmitted over the network or stored on disk.
