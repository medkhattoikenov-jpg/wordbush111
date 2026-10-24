# WordRush 2.0

A real-time classroom quiz platform, upgraded from the original WordRush vocabulary game. Teachers have their own accounts and private quiz library. Students join on their phones with a six-digit PIN and a nickname.

The upgrade is published in [artemskiy01-gif/wordrush](https://github.com/artemskiy01-gif/wordrush/tree/codex/wordrush-2-platform), with [pull request #1](https://github.com/artemskiy01-gif/wordrush/pull/1) tracking the change. The earlier single-teacher project remains its upstream source.

## Run locally

Use Node.js 20+ (Node 22 recommended).

```sh
npm ci
npm start
```

Open [WordRush](http://localhost:3000) for students or [Sign up](http://localhost:3000/signup) to create a teacher account. Accounts, quizzes, login sessions and games persist in `.data/postgres`. A private development session secret is generated in `.data/session-secret`; do not publish `.data/`. No teacher account or shared password is preconfigured.

Local storage uses PGlite, an embedded PostgreSQL implementation. It is a development convenience; production requires an external PostgreSQL database. Only one local process should open the local data directory at a time. Local mobile access can use the computer's LAN address if its firewall permits it; public classroom use needs HTTPS hosting.

Optional settings can go in `.env`; see `.env.example`. PowerShell supports a custom port with `$env:PORT='3137'` before `npm start`.

## Teacher workflow

1. Sign up with your display name, email and password (12+ characters).
2. Create a quiz, or explicitly add the original Holidays sample to your library.
3. Add multiple-choice or True/False questions, choose correct answers and set individual timers.
4. Add, duplicate, delete or reorder questions using the up/down buttons.
5. Save a draft at any time. Changes also autosave after a short pause and have local recovery protection.
6. Publish when the quiz is complete. Publication keeps the quiz private; it does not start a game.
7. Click Host live. Complete saved drafts can also be hosted.
8. Share the student URL and PIN. Press Start when students are ready.
9. Advance after each reveal. The podium appears first; press Next to show everyone's ranking, then finish the game.

Editing a published quiz returns the edited version to draft when autosaved. Publish again when ready. A game already in progress keeps its own immutable quiz copy. Deleting a quiz does not remove the game's captured questions.

The editor clearly reports unsaved, saving, saved, validation and network states. If a different tab saved the same quiz, an outdated revision cannot overwrite it. Unsaved recovery content stays only in that teacher's browser profile and is removed on logout. Avoid shared browser profiles when preparing private quiz content.

## Multiplayer behavior

- Server-authoritative countdowns, one answer per question and 500–1,000 points for a correct answer based on speed.
- Multiple-choice has exactly four buttons; True/False has exactly two.
- Students reconnect with their existing identity, answers and score.
- Teacher control is checked against their account and room ownership for every socket action.
- Answers include question and phase identifiers; duplicate Start/Next commands cannot skip stages.
- Correct answers and current-question score changes are hidden until reveal.
- Durable snapshots restore rooms after a server restart. Deadlines continue during downtime, so an expired question restores at reveal.
- Each room supports 80 students. Multiple teachers can host separate rooms in the single application process.

## Database and migrations

For production, set `DATABASE_URL` to your PostgreSQL connection string. Follow the provider's TLS/certificate instructions; the application does not turn off certificate verification.

```sh
npm run migrate
```

Migrations also run on application startup. Applied filenames are recorded in `schema_migrations`; new schema changes belong in new migration files. Back up the database through your provider before applying future migrations. The production schema contains teacher accounts, database-backed login sessions, private quiz documents, and game snapshots/answers. See [Architecture](docs/ARCHITECTURE.md).

The existing `quizzes/holidays-2a.json` remains intact. Add sample makes a teacher-owned copy after an explicit action. It is not assigned automatically to new users. Existing unpublished MVP live rooms cannot be migrated because the old application stored them only in process memory.

## Production deployment

`render.yaml` prepares a single Render Node web service. Configure:

| Variable         | Value                                                                    |
| ---------------- | ------------------------------------------------------------------------ |
| `NODE_ENV`       | `production`                                                             |
| `DATABASE_URL`   | Durable hosted PostgreSQL, with provider-required TLS settings           |
| `SESSION_SECRET` | At least 32 random characters; keep the same secret across redeployments |
| `APP_URL`        | Exact public HTTPS origin, e.g. `https://your-service.onrender.com`      |
| `PORT`           | Supplied by hosting                                                      |

Render Blueprint can generate `SESSION_SECRET`. Alternatively generate one locally using `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"` and enter it directly into the provider's secret settings. Never commit it. The old `TEACHER_PASSWORD` is unused and should be removed from hosting.

Build with `npm ci --omit=dev`, start with `npm start`, and set the health check to `/health`. Bindings already use `0.0.0.0`. Run one instance: this version's durable room snapshots recover restarts, but its live coordination is not designed for multiple replicas.

Render supports WebSockets. Its free web service can sleep after 15 minutes without inbound traffic and may take about a minute to wake. Local files are ephemeral. Free Render PostgreSQL expires after 30 days, so choose a durable database plan/provider for permanent teacher content. See [Render free-service limitations](https://render.com/docs/free) and [WebSocket hosting](https://render.com/docs/websocket). These provider rules were checked on 24 October 2026.

After configuring hosting, verify the actual HTTPS URL, `/health`, signup/login, an independently joined student device, WebSocket transport, logout, a complete mixed-type quiz and restart recovery. Do not treat a local test or successful build as proof of production deployment. No paid service is required by the application itself; provider plans and limits are separate.

## Security and privacy

Passport Local, bcrypt and express-session provide password authentication and database-backed sessions. Production cookies use HttpOnly, SameSite=Lax and Secure. Mutations require a CSRF token; Origin validation, API/socket ownership checks, rate limiting, input validation, escaped output and Helmet headers are included. Session IDs rotate on login, and logout/expiration invalidates live host control.

Students need no email or account. A room's nickname, answers and scores expire 24 hours after room creation and are removed by hourly cleanup (also at startup). Saved quizzes remain until their owner deletes them. Only the owner can inspect/control their game through teacher APIs. Nicknames and rankings are visible to participants in the same room.

Password recovery, email verification, account administration, advanced analytics, payments, public quiz discovery and media questions are outside this release.

## Validation

```sh
npm run check
npm test
npm audit
```

The portable test runner selects only the project's `tests/` directory; it does not rely on shell wildcard expansion. Tests use real embedded PostgreSQL and independent Socket.IO clients, covering authentication, ownership, drafts, publishing, large quizzes, immutable snapshots, timers, malformed input, question identities, duplicate actions, rankings and disk-backed restart recovery. CI is configured for Node 22 on Windows and Ubuntu.

See [Implementation and verification](docs/IMPLEMENTATION.md) for actual results and remaining production checks. The earlier project study and supplied handoff documents remain local reference material.
