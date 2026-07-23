# User Provisioning App

A Node.js/Express web tool that automates creating Active Directory user accounts for partners through the **ManageEngine ADManager Plus REST API**. Operators fill in a simple form; the app resolves (or creates) the partner's AD group, creates each AD user via an ADManager Plus template, adds them to the group, emails the generated credentials, and records a full audit trail — all with live progress feedback in the browser.

## Table of Contents

- [Quick Start](#quick-start)
- [Purpose](#purpose)
- [Architecture & Tech Stack](#architecture--tech-stack)
- [Project Structure](#project-structure)
- [Authentication & Roles](#authentication--roles)
- [How Provisioning Works](#how-provisioning-works)
- [Routes / Endpoints](#routes--endpoints)
- [Configuration (Environment Variables)](#configuration-environment-variables)
- [Running with Docker](#running-with-docker)
- [Logging & Auditing](#logging--auditing)
- [Notes & Caveats](#notes--caveats)

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Create your local config
cp .env.example .env
# then edit .env — see "Configuration" below for what each value means

# 3. Start in dev mode (auto-restarts on file changes)
npm run dev

# ...or run it plainly
npm start
```

On first startup with an empty database, the app creates a **bootstrap admin** account using `APP_USERNAME` / `APP_PASSWORD` from `.env`. Once the server logs `User Provisioning app listening on port <PORT>`, open:

```
http://localhost:3000/login
```

Log in with the bootstrap admin credentials, then (recommended) create real named accounts under **Admin → Users** and stop using the bootstrap login day-to-day.

Minimum required config to actually provision users:

- `ADMANAGER_HOST`, `ADMANAGER_PORT`, `ADMANAGER_PROTOCOL`, `AUTH_TOKEN`, `DOMAIN_NAME` — connection to ADManager Plus.
- `GROUP_OU`, `GROUP_TEMPLATE_NAME`, `USER_TEMPLATE_NAME` — where/how AD objects get created.
- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` — to email generated credentials to new users.

Use the **"Test Connection"** button on the home page to verify `AUTH_TOKEN`/connectivity to ADManager Plus before provisioning anything.

## Purpose

Manually creating partner AD accounts in ADManager Plus is repetitive and error-prone: for every new partner user, an operator has to find or create the right partner security group, fill in a user-creation template with a consistent naming scheme, add the user to the group, generate a password, and get that password to the new user — usually by hand, over chat or email.

This app turns that into a single guided form:

1. The operator enters the ADManager Plus operator name, partner ID/name, and one or more new users (name, email, an "alt security ID" suffix).
2. The app figures out the partner's AD group (reusing it if it exists, creating it if not).
3. It creates each AD user from a fixed template, wired into that group, with a sanitized/AD-safe SAM account name.
4. It emails the generated password to the user automatically.
5. Every step — success or failure — is written to an audit log and a queryable activity history, visible to admins per-operator.

It intentionally does **not** replace ADManager Plus — it's a thin, opinionated front door onto a couple of its REST endpoints (`CreateUser`, `CreateGroup`, `SearchGroup`, `SearchUser`) with the naming/OU conventions and safety checks this team relies on baked in.

## Architecture & Tech Stack

- **Runtime**: Node.js (Docker image `node:24-alpine`). Uses Node's built-in experimental `node:sqlite` module, so a recent Node version is required.
- **Web framework**: Express 4, server-rendered views via **EJS**.
- **Sessions**: `express-session`, in-memory store, 8-hour cookie.
- **Validation**: `Joi`.
- **AD integration**: `axios`, talking to the ADManager Plus REST API over HTTPS (with certificate verification disabled, since these servers commonly use self-signed certs).
- **Email**: `nodemailer` (any SMTP server, including Gmail with an app password).
- **Passwords**: `bcryptjs` for local app-login password hashing.
- **Persistence**: SQLite via `node:sqlite` (`DatabaseSync`), file at `data/app.db`, WAL mode. No ORM, no migrations tool.
- **Logging**: `winston` — JSON file logs plus colorized console output.
- **Frontend**: plain JS + `EventSource` (Server-Sent Events) for live provisioning progress, no build step, no framework.
- No automated test suite currently exists.

## Project Structure

```
src/
  app.js                          Express app setup: middleware, view engine, routes, error handler
  server.js                       Entry point: loads .env, bootstraps admin user, starts HTTP server
  routes/
    index.js                      Login, home page, /test-connection, /provision/stream (SSE)
    admin.js                      /admin subrouter: user management, stats, per-operator activity
  controllers/
    provisioning.controller.js    Core SSE-driven provisioning workflow
  middleware/
    auth.js                       requireAuth / requireAdmin session guards
    validate.js                   Joi schema for provisioning form input
  services/
    admanager.service.js          ADManager Plus REST API client
    mail.service.js                nodemailer wrapper for sending credential emails
  utils/
    adHelpers.js                  AD-safe string sanitizing/truncation, group name/DN builders
    dedupe.js                     Short-lived in-memory cache to block duplicate/double-click submits
    logger.js                     winston logger + audit() helper (strips passwords before logging)
    store.js                      SQLite-backed app users & activity history (also the local login store)
views/                           login.ejs, index.ejs (provisioning form), admin.ejs, operator.ejs
public/                          css/style.css, js/main.js (form logic + SSE consumer)
data/                            app.db (+ -shm/-wal) — gitignored
logs/                            audit.log, error.log — gitignored
```

## Authentication & Roles

- Login is **session-based**, backed by a local SQLite `users` table — this is a separate login system from the AD accounts being provisioned.
- Two roles: **`admin`** and **`operator`**.
  - `operator`: can log in and submit provisioning requests.
  - `admin`: everything an operator can do, plus the `/admin` dashboard — create/block/delete app users, and drill into any operator's activity history.
- On first run, if the `users` table is empty, a single bootstrap admin is created from `APP_USERNAME` / `APP_PASSWORD`. This only happens once.
- Safety rails in the admin panel: an admin can't block or delete their own account, and can't block or delete the last remaining active admin — this prevents total lockout of the app.
- Blocked accounts (`status = blocked`) can't log in.
- All operators/admins share the **same** ADManager Plus `AUTH_TOKEN` — the app's roles control who can use *this app* and see *its* data, not who can act in Active Directory. AD-side permissions are entirely governed by what the shared `AUTH_TOKEN` is allowed to do in ADManager Plus.

## How Provisioning Works

Provisioning happens over `GET /provision/stream`, a **Server-Sent Events** endpoint — the browser gets a live step-by-step feed instead of waiting for one big response. Steps (each reported as `progress` / `done` / `warn` / `error`):

1. **Validate** — Joi validates the operator name, partner ID/name, and each user (name, "alt security ID" suffix, email). The operator must have manually checked "I have verified this group name in ADManager Plus" (the UI forces re-confirmation whenever partner name/ID changes). A short in-memory dedupe cache also rejects an identical submission (`partnerId + name + email`) if resubmitted within `DEDUPE_WINDOW_SECONDS`.
2. **Resolve the partner group** — Builds the group name as `<PartnerName>-RDS-<PartnerId>`. Searches for it in AD via `SearchGroup`; if found, reuses its DN. If not found, creates it via `CreateGroup` using `GROUP_TEMPLATE_NAME`, `GROUP_TYPE`, `GROUP_SCOPE`, and `GROUP_OU`. If the group API call fails outright (e.g. insufficient permissions), the app falls back to the manually-confirmed group DN and warns rather than aborting — this is exactly why the manual confirmation checkbox exists as a safety net.
3. **Create each user** — For every user in the batch: sanitize and truncate the name to `SAM_MAX_LENGTH` (AD's SAM-account-name limit), build `altSecurityIdentities`, then call `CreateUser` (template `USER_TEMPLATE_NAME`) with `memberof` set to the resolved group DN, so the user is created already inside the group. ADManager Plus returns a generated password.
4. **Email credentials** — Sends the new logon name + password to the user's email via SMTP. If the email fails to send, the password is instead shown once in the browser (via SSE) so the operator can deliver it manually — it is never shown again, and is never written to the audit log.
5. **Record the outcome** — Every attempt (success, per-user failure, or validation failure) is written both to the file-based audit log (`logs/audit.log`) and to the SQLite `activity` table, which powers the admin/operator activity dashboards. Passwords are stripped before anything is logged.
6. **Done** — A final summary event reports overall status: `success` (all users created and emailed), `partial` (some failed or had email errors), or `error` (all failed). The form only auto-resets on full success.

Failures for one user in a batch don't abort the rest — the app keeps going and reports a per-user result.

## Routes / Endpoints

### Public / session (`src/routes/index.js`)

| Method & Path | Auth | Description |
|---|---|---|
| `GET /login` | — | Login page |
| `POST /login` | — | Verifies credentials, starts session |
| `POST /logout` | — | Destroys session |
| `GET /` | operator+ | Provisioning form |
| `GET /test-connection` | operator+ | Verifies ADManager Plus connectivity/`AUTH_TOKEN` |
| `GET /provision/stream` | operator+ | SSE provisioning workflow (see above) |

### Admin (`src/routes/admin.js`, mounted at `/admin`, admin-only)

| Method & Path | Description |
|---|---|
| `GET /admin/` | Dashboard: stats, all app users, last 100 activity entries |
| `GET /admin/users/:id` | Drill-down: one operator's full activity history |
| `POST /admin/users` | Create a new app user (operator or admin) |
| `POST /admin/users/:id/block` | Toggle a user's active/blocked status |
| `POST /admin/users/:id/delete` | Delete a user record |

## Configuration (Environment Variables)

Copy `.env.example` to `.env` and fill these in. `.env` is gitignored — never commit real secrets.

| Variable | Default (example) | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port the server listens on |
| `APP_USERNAME` | `admin` | Bootstrap admin username (used only when the `users` table is empty) |
| `APP_PASSWORD` | `changeme` | Bootstrap admin password (bcrypt-hashed on insert) |
| `SESSION_SECRET` | — | Secret used to sign the session cookie — set a long random value |
| `ADMANAGER_PROTOCOL` | `https` | Protocol used to reach ADManager Plus |
| `ADMANAGER_HOST` | — | ADManager Plus server host/IP |
| `ADMANAGER_PORT` | `8080` | ADManager Plus REST API port |
| `DOMAIN_NAME` | `agpremote.local` | AD domain passed to every ADManager Plus API call |
| `AUTH_TOKEN` | — | ADManager Plus API auth token (required) |
| `PRODUCT_NAME` | `UserProvisioningApp` | Product identifier sent with every API call |
| `USER_TEMPLATE_NAME` | `CreateNewUser` | ADManager Plus template used to create users |
| `GROUP_TEMPLATE_NAME` | `Partner-Group-Templates` | ADManager Plus template used to create groups |
| `GROUP_OU` | `OU=Groups,OU=RemoteApp,DC=agpremote,DC=local` | OU where partner groups live/are created |
| `GROUP_SCOPE` | `Global` | AD group scope for new groups |
| `GROUP_TYPE` | `Security` | AD group type for new groups |
| `SAM_MAX_LENGTH` | `20` | Max length for generated SAM account names |
| `DEDUPE_WINDOW_SECONDS` | `60` | Window during which an identical submission is rejected as a duplicate |
| `SMTP_HOST` | — | SMTP server host for sending credential emails |
| `SMTP_PORT` | `587` | SMTP port (use `465` with `SMTP_SECURE=true` if `587` is blocked on your network) |
| `SMTP_SECURE` | `false` | `true` for implicit TLS (port 465), `false` for STARTTLS (port 587) |
| `SMTP_USER` | — | SMTP auth username (e.g. a Gmail address) |
| `SMTP_PASS` | — | SMTP auth password (e.g. a Gmail app password) |
| `SMTP_FROM` | `"User Provisioning <noreply@example.com>"` | From-address for credential emails |

## Running with Docker

```bash
docker compose up -d --build
```

- Builds from `Dockerfile` (`node:24-alpine`, `npm install --omit=dev`).
- Exposes port `3000` (mapped `3000:3000` in `docker-compose.yaml`).
- Loads config from `.env` (must exist next to `docker-compose.yaml`).
- Mounts `./logs` and `./data` into the container so audit logs and the SQLite DB persist across rebuilds/restarts.

## Logging & Auditing

- `logs/audit.log` — JSON, every provisioning attempt (success/failure/validation rejection), auth-related events, etc. Passwords are always stripped before writing.
- `logs/error.log` — error-level events only.
- Console output is also enabled (colorized) — visible via `docker logs` in a container.
- The SQLite `activity` table gives the same events a queryable, per-operator view, surfaced in the Admin dashboard and each operator's detail page.

## Notes & Caveats

- There is no automated test suite yet.
- TLS certificate verification is disabled for the ADManager Plus API client, to tolerate self-signed certificates common on internal ADManager Plus deployments — only point this at a trusted internal host.
- Some internal error messages in `admanager.service.js` and `mail.service.js` are written in Armenian; the rest of the codebase (UI, comments, SSE messages) is in English.
- All app users share a single ADManager Plus `AUTH_TOKEN` — app roles (`admin`/`operator`) control access to this tool, not to Active Directory itself.
- Generated passwords are only ever shown once (in the browser, and only if the credential email fails to send) — they are never persisted or logged in plaintext.
# admanager
