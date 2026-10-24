# WordRush 2.0 architecture

The upgrade keeps Express, Socket.IO and the vanilla JavaScript frontend from the original application. The teacher studio adds account access, a private quiz library and an editor around that game engine.

## Storage

Production uses PostgreSQL through `pg` and parameterized queries. Without `DATABASE_URL`, development uses PGlite (embedded PostgreSQL) in `.data/postgres`. Production refuses the local filesystem fallback. The same migration SQL and application queries run in both modes. The production PostgreSQL adapter still needs verification against the chosen hosted database before deployment.

`migrations/001-platform.sql` creates teachers, server-side login sessions, teacher-owned quizzes and game sessions. Questions and options are stored as an ordered JSONB quiz document, avoiding multi-table writes when reordering or saving drafts. Every question has a stable UUID and explicit type, options, correct index and timer. Quiz writes use an optimistic revision check to prevent overwriting another tab's saved work.

Each hosted game stores its own immutable quiz document and a durable snapshot containing phase, deadline, participants, answers and scores. Writes are serialized per room, persisted before acknowledgement/broadcast and rolled back in memory on storage failure. Game tokens are random bearer identities; only their SHA-256 digests are stored. Socket IDs and online flags are transient. Startup restores rooms and reveals questions whose deadlines expired during downtime; timers do not pause while the server is down.

Accounts, quizzes, login sessions and acknowledged game state therefore survive a restart if the same database and session secret are retained. If the hosting provider deletes the database, this application cannot recover it; configure provider backups appropriately.

## Authentication and authorization

Passport Local handles teacher password authentication. bcrypt hashes passwords with cost 12. Passwords require at least 12 characters, with the bcrypt 72-byte maximum enforced. express-session manages signed, HttpOnly, SameSite=Lax cookies backed by PostgreSQL, with a seven-day rolling lifetime. Production cookies are Secure. Sign-in rotates the session ID; logout destroys the session. The old shared teacher password and host tokens are removed.

State-changing HTTP requests require a session-bound CSRF token and validate Origin when present. Socket.IO handshakes reject other origins. Every teacher socket event reloads the login session, validates its CSRF token, checks the game owner and checks the active hosting socket. Logging out or expiring the session invalidates control even for an already connected host.

Teacher APIs always scope quiz queries to the signed-in owner. Missing and other-account quiz identifiers both return 404. Published means ready to play, not publicly discoverable. The old Holidays JSON stays in the repository and is copied into a teacher account only after that teacher explicitly chooses Add sample.

Authentication, registration and write APIs are rate limited. Student joins have a per-address limit and every socket has a message limit. Helmet supplies browser security headers. User-provided text is escaped before HTML insertion. Database credentials and teacher authentication tokens are never put in frontend JavaScript/localStorage. Editor recovery copies can contain that teacher's unsaved quiz content; they are scoped to the teacher ID and cleared on logout.

## Quiz lifecycle and editor

Drafts accept incomplete titles, prompts and correct selections while preserving a structurally valid document. Publishing and hosting validate all content: a title, at least one complete question, distinct nonempty choices, exactly one correct index, and valid timers. Valid drafts can be hosted. Autosave saves edits as drafts; editing a published quiz therefore returns it to draft status until the teacher publishes again. Existing live games continue using their captured copy.

The editor renders one question form at a time, with a lightweight navigation list. Add, duplicate, delete, move up/down, change type, set timer and select the correct answer are supported. Reordering uses accessible buttons rather than requiring drag-and-drop. A request safeguard allows up to 2,000 questions within a 2 MB JSON request; ordinary lesson sizes are not restricted to 20 or 100 questions.

Manual Save draft, Publish, debounced autosave, local recovery, before-unload protection and visible validation/network errors protect work. A failed publish does not overwrite the saved draft. Conflicting revisions require the teacher to review/reload rather than silently losing another tab's changes.

## Game protocol

`lobby → question → reveal → … → podium → leaderboard → finished`

Each transition creates a new phase UUID. Host commands submit the expected phase UUID, so duplicate Start/Next requests cannot advance several phases. Student answers submit both the question UUID and phase UUID, preventing delayed answers from landing on another question. The server validates the choice count for the question type, rejects duplicate/late answers and computes the original 500–1,000 speed-and-accuracy points. Ranking uses score, correct count, join time and then nickname.

All players receive the same options and server deadline. Clients compensate for clock offset using the server timestamp. During a live question, correct-answer fields and current-question score/correct-count changes are withheld. Results appear at reveal. The teacher controls progression and must press Next between the podium and full ranking. End Game intentionally allows an early finish after confirmation.

Students need no account. Their reconnect identity is retained locally, and they can resume after a refresh or server restart. Repeated joins on the same attached socket are rejected; explicit leave removes a lobby entry. Disconnected participants remain in the room so their identity/scores can be recovered, and unanswered disconnected students can keep the question open until its deadline.

## Retention and operating scope

Game participation, snapshots, answers and scores expire 24 hours after room creation and are deleted by hourly cleanup (also at startup). Expired rooms cannot be resumed. Teachers' saved quizzes remain until explicitly deleted. Expired login sessions are cleaned on the same schedule.

Run one application instance. Durable snapshots recover restarts, but the live in-process coordination does not support multiple application replicas. Scaling replicas requires shared real-time state/locking and a Socket.IO adapter. Multiple independent teachers and rooms within the one process are supported; each room allows 80 students, and each teacher may have up to 10 unfinished rooms as an abuse safeguard.

Password recovery/email verification, public quiz discovery, student accounts, media questions, subscriptions and advanced analytics are outside this version's scope.
