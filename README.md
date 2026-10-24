# User Provisioning App

A Node.js/Express web tool that automates creating Active Directory user accounts for partners through the **ManageEngine ADManager Plus REST API**. Operators fill in a simple form; the app resolves (or creates) the partner's AD group, creates each AD user via an ADManager Plus template, adds them to the group, emails the generated credentials, and records a full audit trail — all with live progress feedback in the browser.

## Table of Contents

- [Quick Start](#quick-start)
- [Purpose](#purpose)
- [Architecture & Tech Stack](#architecture--tech-stack)
- [Project Structure](#project-structure)
- [Authentication & Roles](#authentication--roles)
- [How Provisioning Works](#how-provisioning-works)
- [Password Reset](#password-reset)
- [Groups](#groups)
- [Directory](#directory)
- [AD Data Import (CSV)](#ad-data-import-csv)
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
    passwordReset.js              /reset-password subrouter: admin-only AD password reset (SSE)
    groups.js                     /groups subrouter: browse imported AD groups, view/enable/disable members
    directory.js                  /directory subrouter: search imported AD users, enable/disable accounts
  controllers/
    provisioning.controller.js    Core SSE-driven provisioning workflow
    passwordReset.controller.js   SSE-driven password-reset workflow
    groups.controller.js          Group search (from imported data), live member lookup, enable/disable
    directory.controller.js       AD user search (from imported data) and enable/disable
  middleware/
    auth.js                       requireAuth / requireAdmin session guards
    validate.js                   Joi schemas for provisioning, password reset, and enable/disable input
  services/
    admanager.service.js          ADManager Plus REST API client
    mail.service.js                nodemailer wrapper for sending credential emails
  scripts/
    import-ad-export.js           One-off/re-runnable importer for ADManager Plus CSV exports (groups & users)
  utils/
    adHelpers.js                  AD-safe string sanitizing/truncation, group name/DN builders, group-name parsing
    dedupe.js                     Short-lived in-memory cache to block duplicate/double-click submits
    logger.js                     winston logger + audit() helper (strips passwords before logging)
    store.js                      SQLite-backed app users, activity history, and imported AD groups/users
    baseDir.js                    Resolves the app's base folder — the .exe's own folder when packaged, project root otherwise
    embeddedAssets.js              Self-extracts views/public/assets and the default .env template from inside the packaged .exe
scripts/
  build-exe.js                    Bundles + packages the app (with embedded assets) into dist/UserProvisioning.exe (see below)
  install-shared.js               Installs the .exe to C:\ProgramData\UserProvisioning and creates the Desktop shortcut(s)
views/                           login.ejs, index.ejs (provisioning form), admin.ejs, operator.ejs,
                                 reset-password.ejs, groups.ejs, directory.ejs
public/                          css/style.css, js/main.js, js/reset-password.js, js/groups.js, js/directory.js
data/                            app.db (+ -shm/-wal), imports/ (ad_groups.csv, ad_users.csv) — gitignored
logs/                            audit.log, error.log — gitignored
assets/                          Windows-App-Guide.pdf — end-user setup guide
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

1. **Validate** — Joi validates the operator name, partner ID/name, and each user (name, "alt security ID" suffix, contact email). The operator must have manually checked "I have verified this group name in ADManager Plus" (the UI forces re-confirmation whenever partner name/ID changes). A short in-memory dedupe cache also rejects an identical submission (`partnerId + givenName + email`) if resubmitted within `DEDUPE_WINDOW_SECONDS`.
2. **Resolve the partner group** — Builds the group name as `<PartnerName>-RDS-<PartnerId>`. Searches for it in AD via `SearchGroup`; if found, reuses its DN. If not found, creates it via `CreateGroup` using `GROUP_TEMPLATE_NAME`, `GROUP_TYPE`, `GROUP_SCOPE`, and `GROUP_OU`. If the group API call fails outright (e.g. insufficient permissions), the app falls back to the manually-confirmed group DN and warns rather than aborting — this is exactly why the manual confirmation checkbox exists as a safety net.
3. **Create each user** — For every user in the batch: sanitize and truncate the name to `SAM_MAX_LENGTH` (AD's SAM-account-name limit), build `altSecurityIdentities`, then call `CreateUser` (template `USER_TEMPLATE_NAME`) with `memberof` set to the resolved group DN, so the user is created already inside the group. ADManager Plus returns the generated logon name (`sAMAccountName`) and password, and the AD/Exchange template auto-provisions a mailbox for the account at `<sAMAccountName>@<USER_MAIL_DOMAIN>` (e.g. `test910.Betconstruct@bcapps.cloud`).
4. **Email credentials** — The new account's own mailbox (`<sAMAccountName>@<USER_MAIL_DOMAIN>`) can't be reached until its password is known, so credentials are never sent there. Instead they're emailed to the **contact email** entered in the form, with the message body containing both the new account address and the password — that's the one piece of information the recipient needs to actually log into their new mailbox/account. Network-level failures (a connection that never completes or gets reset) are retried, up to 3 attempts that each give up after 15s; if the email still fails to send, the account address and password are instead shown once in the browser (via SSE) so the operator can deliver them manually — never shown again, and never written to the audit log.
5. **Record the outcome** — Every attempt (success, per-user failure, or validation failure) is written both to the file-based audit log (`logs/audit.log`) and to the SQLite `activity` table, which powers the admin/operator activity dashboards. Passwords are stripped before anything is logged.
6. **Done** — A final summary event reports overall status: `success` (all users created and emailed), `partial` (some failed or had email errors), or `error` (all failed). The form only auto-resets on full success.

Failures for one user in a batch don't abort the rest — the app keeps going and reports a per-user result.

## Password Reset

A separate, admin-only section (`/reset-password`) for resetting an existing AD user's password, for cases like a partner user forgetting their credentials. Unlike provisioning, the account being reset and the person who should receive the new password aren't necessarily the same mailbox, so the form takes **two independent addresses**:

- **AD Account Email (`targetEmail`)** — the address ADManager Plus searches for via the AD `mail` attribute (e.g. the account's own `@bcapps.cloud` mailbox) to identify which user to reset.
- **Send New Password To (`notifyEmail`)** — wherever the new password should actually be delivered (can be a different address, e.g. the partner's real contact email).

Steps:

1. **Validate** — both addresses must be well-formed emails.
2. **Reset** — a strong random password is generated locally, then `adManager.resetPassword(targetEmail, password)` calls ADManager Plus's `ResetPwd` REST action, searching directly by the `mail` attribute. If no AD user has that email (or the `AuthToken` lacks permission), ADManager Plus returns a non-success result, which is surfaced as a clear **error** — the reset is never silently skipped.
3. **Email** — on a successful reset, the new password is emailed to `notifyEmail`. If delivery fails, the password is shown once in the browser (same "copy now" pattern as provisioning) and the outcome is marked as `partial` rather than `success`.
4. **Audit** — every attempt (success, email failure, or "no such user") is logged to `logs/audit.log` and the `activity` table (tagged `type: 'password_reset'`, with both `targetEmail` and `notifyEmail` recorded), and shows up in the Admin dashboard's activity feed as its own row type. Passwords are never persisted or logged.

This is restricted to `admin` role because, unlike creating a brand-new account, resetting an *existing* user's password from just an email address is a more sensitive, account-takeover-adjacent operation.

## Groups

An admin-only page (`/groups`) for browsing existing partner groups instead of guessing group names by hand:

- **Search** hits `GET /groups/api/search-all`, which queries the `ad_groups` table populated by the [CSV import](#ad-data-import-csv) — ADManager Plus on this deployment has no live "list/search all groups" REST endpoint, so the searchable list is a point-in-time snapshot, refreshed by re-running the importer. Group names are parsed back into `{ partner, partnerId }` via `parseGroupName()` (the inverse of the provisioning form's `<PartnerName>-RDS-<PartnerId>` naming convention).
- Picking a group calls `GET /groups/api/members`, which *does* hit ADManager Plus live (`listAllUsers`, filtered by the group's partner name) — so members and their enabled/disabled state are always current, even though the group list itself is a snapshot.
- Each member row can be enabled/disabled via `POST /groups/api/toggle`, which calls ADManager Plus's `EnableUser`/`DisableUser` REST actions by email and is fully audited (`type: 'group_toggle'`).
- A "Create a new group" panel builds and previews the group name/pre-Windows-2000 name for the operator to enter manually in ADManager Plus, since group creation via API isn't available on this ADManager Plus server either — this only affects the standalone Groups page; the main provisioning form still creates groups via `CreateGroup` (see [How Provisioning Works](#how-provisioning-works)) where that API is supported.
- The group **search-all** endpoint (only) is available to any authenticated operator, not just admins — it's read-only and non-sensitive, and lets operators look up a partner's existing group name while filling out the provisioning form instead of retyping it from memory.

## Directory

An admin-only page (`/directory`) for searching the full imported AD user list and toggling accounts:

- Search (`GET /directory/api/search`) queries the `ad_users` table (name, SAM account, company, AGP, or email) — again sourced from the [CSV import](#ad-data-import-csv), not a live AD query, so it reflects the last import rather than the current instant.
- Each result can be enabled/disabled via `POST /directory/api/toggle`, which calls ADManager Plus live (`EnableUser`/`DisableUser` by email) and is fully audited (`type: 'directory_toggle'`); the local snapshot's `account_status` is updated immediately after a successful toggle so the UI stays in sync without waiting for the next import.
- Accounts with no mailbox (`Email Address` = `-` in the export) can't be toggled through ADManager Plus and are shown status-only.
- The page header shows import freshness (user/group counts and last-imported timestamp) so admins know how stale the snapshot might be.

## AD Data Import (CSV)

Both [Groups](#groups) and [Directory](#directory) search against a local snapshot of AD, because this ADManager Plus deployment doesn't expose live "list/search all groups" or "list/search all users" REST endpoints. That snapshot is populated by re-runnable script `src/scripts/import-ad-export.js`:

```bash
node src/scripts/import-ad-export.js
```

- Drop a fresh ADManager Plus CSV export at `data/imports/ad_groups.csv` and/or `data/imports/ad_users.csv`, then run the script — rows are **upserted** by SAM Account Name into the SQLite `ad_groups` / `ad_users` tables, so re-running it with a newer export updates existing rows instead of duplicating them. Either file may be absent; the script skips whichever one it doesn't find.
- Re-run it whenever the underlying AD data changes meaningfully — there's no automatic refresh or schedule.
- `data/imports/` is covered by the existing `data/*` gitignore rule, so exports aren't committed.

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

### Password Reset (`src/routes/passwordReset.js`, mounted at `/reset-password`, admin-only)

| Method & Path | Description |
|---|---|
| `GET /reset-password/` | Password reset form |
| `GET /reset-password/stream` | SSE password-reset workflow (see above) |

### Groups (`src/routes/groups.js`, mounted at `/groups`)

| Method & Path | Auth | Description |
|---|---|---|
| `GET /groups/api/search-all` | operator+ | Search imported AD groups by partner name/ID/SAM account name |
| `GET /groups/` | admin | Groups browser page |
| `GET /groups/api/members` | admin | Live AD lookup of a group's members by partner name |
| `POST /groups/api/toggle` | admin | Enable/disable a group member's AD account |

### Directory (`src/routes/directory.js`, mounted at `/directory`, admin-only)

| Method & Path | Description |
|---|---|
| `GET /directory/` | AD user directory/search page |
| `GET /directory/api/search` | Search imported AD users by name, SAM account, company, AGP, or email |
| `POST /directory/api/toggle` | Enable/disable an AD account |

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
| `USER_MAIL_DOMAIN` | `bcapps.cloud` | Domain used to build the new AD account's mailbox address (`<sAMAccountName>@<USER_MAIL_DOMAIN>`), shown in the credentials email alongside the password — not itself the send destination |
| `SMTP_HOST` | — | SMTP server host for sending credential emails |
| `SMTP_PORT` | `587` | SMTP port (use `465` with `SMTP_SECURE=true` if `587` is blocked on your network) |
| `SMTP_SECURE` | `false` | `true` for implicit TLS (port 465), `false` for STARTTLS (port 587) |
| `SMTP_USER` | — | SMTP auth username (e.g. a Gmail address) |
| `SMTP_PASS` | — | SMTP auth password (e.g. a Gmail app password) |
| `SMTP_FROM` | `"User Provisioning <noreply@example.com>"` | From-address for credential emails |
| `SMTP_ALLOW_SELF_SIGNED_TLS` | — | `true` accepts a self-signed certificate on the SMTP connection only — a stopgap for antivirus/proxy TLS inspection (e.g. Kaspersky) that substitutes its own certificate; remove once the app is excluded from inspection |

## Packaging as a Windows .exe (shared, single-machine deployment)

For a single Windows machine shared by several local Windows user accounts (everyone logs into the same PC and just wants to open the app in their browser), the whole app packages into **one self-contained `.exe`** — no separate Node.js install needed, since the exact Node runtime is embedded via Node's built-in [Single Executable Application](https://nodejs.org/api/single-executable-applications.html) support, and `views/`, `public/`, `assets/`, and a default `.env` template are embedded *inside* the `.exe` itself (see `src/utils/embeddedAssets.js`) and self-extracted next to it on every startup. There is nothing else to copy around — the `.exe` alone is the whole distributable.

```bash
npm run build:exe        # -> dist/UserProvisioning.exe, plus deploy/ for local testing
npm run install:shared   # installs it to C:\ProgramData\UserProvisioning and adds a Desktop shortcut
```

`install:shared`:
- Copies the `.exe` (always refreshed) into `C:\ProgramData\UserProvisioning` — the standard, machine-wide, all-users-shared Windows location (not `%TEMP%`, which is **per-user** and would silently defeat the "shared DB" goal).
- Seeds `.env` and `data/` (the SQLite DB — app users, imported AD groups/users, activity history) from the project's own copies **only if the shared location doesn't already have them** — an install that's already live is never clobbered by a later rebuild.
- Writes a hidden-window launcher (`Start-UserProvisioning.vbs`) next to the `.exe`, and creates a **"User Provisioning" Desktop shortcut** pointed at that launcher. It tries `C:\Users\Public\Desktop` (appears on every Windows user's Desktop) first; that requires administrator rights, so if it's not run elevated it falls back to just the current user's Desktop and tells you to re-run elevated to cover everyone.

What happens when someone double-clicks the shortcut:
- **No console window appears** — the launcher starts the `.exe` hidden.
- If no instance is running yet, it starts the server and **automatically opens the default browser** to the login page.
- If an instance is **already running** (started earlier by someone else on the same machine), it detects that and just opens a browser tab to the existing one instead of starting a second process — this is what keeps the DB single and shared: only one process ever owns `data/app.db` at a time, no matter who clicks the shortcut or when.

To push out a code change: `npm run build:exe && npm run install:shared` — the shared `.env`/`data`/`logs` are left alone; only the `.exe` and embedded static assets refresh.

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
- This ADManager Plus deployment has no live "list/search all groups or users" REST endpoint, so the [Groups](#groups) and [Directory](#directory) pages search a local snapshot populated by [the CSV importer](#ad-data-import-csv) — it can go stale until someone re-runs the import. Enable/disable actions on those pages, and group *members* on the Groups page, still call ADManager Plus live.
- Group creation via API is also unavailable on this ADManager Plus server for the standalone Groups page's "create a new group" flow — it only builds a name preview for manual entry. The main provisioning form's own group creation (`CreateGroup`) is unaffected and works as described in [How Provisioning Works](#how-provisioning-works).
- `assets/Windows-App-Guide.pdf` is an end-user setup guide, not part of the app's runtime.
