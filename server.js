"use strict";
require("dotenv").config({ quiet: true });
const express = require("express");
const { createServer } = require("node:http");
const { Server } = require("socket.io");
const { randomBytes, randomUUID } = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const { openDatabase } = require("./lib/db");
const { setupAuth, safeEqual, publicUser } = require("./lib/auth");
const {
  Problem,
  normalizeQuiz,
  requirePlayable,
  playableErrors,
  ownedQuiz,
  fromRow,
} = require("./lib/quizzes");
const { GameEngine } = require("./lib/game");
const route = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

async function createApplication(options = {}) {
  const production = process.env.NODE_ENV === "production",
    appUrl = process.env.APP_URL;
  if (production && (!appUrl || !appUrl.startsWith("https://")))
    throw Error("Set APP_URL to the public HTTPS URL.");
  let secret = options.secret || process.env.SESSION_SECRET;
  if (!secret && !production) {
    const file = path.join(__dirname, ".data", "session-secret");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file))
      fs.writeFileSync(file, randomBytes(48).toString("hex"), { mode: 0o600 });
    secret = fs.readFileSync(file, "utf8");
  }
  if (!secret || secret.length < 32)
    throw Error("SESSION_SECRET must contain at least 32 random characters.");
  const db = options.db || (await openDatabase(options.database));
  const config = {
    production,
    secret,
    origin: (req) =>
      appUrl ? new URL(appUrl).origin : `${req.protocol}://${req.get("host")}`,
  };
  const app = express(),
    httpServer = createServer(app);
  app.disable("x-powered-by");
  if (production) app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "script-src": ["'self'"],
          "style-src": ["'self'", "'unsafe-inline'"],
          "font-src": ["'self'"],
          "connect-src": ["'self'"],
          "img-src": ["'self'", "data:"],
          "upgrade-insecure-requests": production ? [] : null,
        },
      },
      strictTransportSecurity: production ? undefined : false,
    }),
  );
  app.use(express.json({ limit: "2mb" }));
  const auth = await setupAuth(app, db, config);
  auth.safeEqual = safeEqual;
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  const limiter = (windowMs, limit, message) =>
    rateLimit({
      windowMs,
      limit: options.test ? 2000 : limit,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { message },
    });
  const authLimiter = limiter(
    900000,
    35,
    "Too many login attempts. Try again in 15 minutes.",
  );
  const signupLimiter = limiter(
    3600000,
    10,
    "Too many registrations. Try again later.",
  );
  const writes = limiter(
    60000,
    150,
    "Please wait a moment before trying again.",
  );
  app.get("/api/session", (req, res) =>
    res.json({ user: req.user || null, csrfToken: auth.csrfToken(req) }),
  );
  app.post(
    "/api/auth/signup",
    signupLimiter,
    auth.csrf,
    route(async (req, res) => {
      const { name, email, password, confirmPassword } = req.body || {};
      if (
        typeof name !== "string" ||
        name.trim().length < 2 ||
        name.trim().length > 80
      )
        throw new Problem(422, "Enter a display name of 2–80 characters.");
      if (
        typeof email !== "string" ||
        email.length > 254 ||
        !/^\S+@[^\s@]+\.[^\s@]+$/.test(email.trim())
      )
        throw new Problem(422, "Enter a valid email address.");
      if (
        typeof password !== "string" ||
        password.length < 12 ||
        Buffer.byteLength(password) > 72
      )
        throw new Problem(
          422,
          "Use at least 12 characters and no more than 72 bytes for your password.",
        );
      if (password !== confirmPassword)
        throw new Problem(422, "Your passwords do not match.");
      const hash = await bcrypt.hash(password, 12);
      let user;
      try {
        user = (
          await db.query(
            "INSERT INTO teachers(id,name,email,password_hash) VALUES($1,$2,$3,$4) RETURNING *",
            [randomUUID(), name.trim(), email.trim().toLowerCase(), hash],
          )
        ).rows[0];
      } catch (error) {
        if (error.code === "23505")
          throw new Problem(409, "An account with this email already exists.");
        throw error;
      }
      await new Promise((resolve, reject) =>
        req.logIn(publicUser(user), (error) =>
          error ? reject(error) : resolve(),
        ),
      );
      const csrfToken = auth.csrfToken(req);
      await new Promise((resolve, reject) =>
        req.session.save((error) => (error ? reject(error) : resolve())),
      );
      res.status(201).json({ user: req.user, csrfToken });
    }),
  );
  app.post("/api/auth/login", authLimiter, auth.csrf, (req, res, next) => {
    auth.passport.authenticate("local", (error, user) => {
      if (error) return next(error);
      if (!user)
        return next(new Problem(401, "Email or password is incorrect."));
      req.logIn(user, (error) => {
        if (error) return next(error);
        const csrfToken = auth.csrfToken(req);
        req.session.save((error) =>
          error ? next(error) : res.json({ user, csrfToken }),
        );
      });
    })(req, res, next);
  });
  app.post(
    "/api/auth/logout",
    auth.requireUser,
    auth.csrf,
    route(async (req, res) => {
      await new Promise((resolve, reject) =>
        req.session.destroy((error) => (error ? reject(error) : resolve())),
      );
      res.clearCookie("wordrush.sid", {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: production,
      });
      res.json({ ok: true });
    }),
  );
  app.use("/api/quizzes", auth.requireUser);
  app.get(
    "/api/quizzes",
    route(async (req, res) => {
      const result = await db.query(
        "SELECT * FROM quizzes WHERE owner_id=$1 ORDER BY updated_at DESC",
        [req.user.id],
      );
      res.json(
        result.rows.map((row) => {
          const q = fromRow(row);
          return {
            ...q,
            questions: undefined,
            questionCount: q.questions.length,
            playable: playableErrors(q).length === 0,
          };
        }),
      );
    }),
  );
  async function insertQuiz(owner, q) {
    const result = await db.query(
      "INSERT INTO quizzes(id,owner_id,title,description,status,questions) VALUES($1,$2,$3,$4,$5,$6::jsonb) RETURNING *",
      [
        randomUUID(),
        owner,
        q.title,
        q.description,
        "draft",
        JSON.stringify(q.questions),
      ],
    );
    return fromRow(result.rows[0]);
  }
  app.post(
    "/api/quizzes",
    writes,
    auth.csrf,
    route(async (req, res) =>
      res
        .status(201)
        .json(await insertQuiz(req.user.id, normalizeQuiz(req.body))),
    ),
  );
  app.post(
    "/api/quizzes/import-sample",
    writes,
    auth.csrf,
    route(async (req, res) => {
      const sample = JSON.parse(
        fs.readFileSync(
          path.join(__dirname, "quizzes", "holidays-2a.json"),
          "utf8",
        ),
      );
      const q = normalizeQuiz({
        title: sample.title,
        description: sample.subtitle,
        questions: sample.questions.map((q) => ({
          ...q,
          type: "multiple-choice",
          duration: sample.duration,
        })),
      });
      res.status(201).json(await insertQuiz(req.user.id, q));
    }),
  );
  app.get(
    "/api/quizzes/:id",
    route(async (req, res) =>
      res.json(await ownedQuiz(db, req.params.id, req.user.id)),
    ),
  );
  app.put(
    "/api/quizzes/:id",
    writes,
    auth.csrf,
    route(async (req, res) => {
      const original = await ownedQuiz(db, req.params.id, req.user.id),
        q = normalizeQuiz(req.body);
      if (
        !Number.isInteger(req.body.revision) ||
        req.body.revision !== original.revision
      )
        throw new Problem(
          409,
          "This quiz changed in another tab. Copy your edits, then reload before saving.",
        );
      const status = req.body.status === "published" ? "published" : "draft";
      if (status === "published") requirePlayable(q);
      const result = await db.query(
        "UPDATE quizzes SET title=$3,description=$4,status=$5,questions=$6::jsonb,revision=revision+1,updated_at=CURRENT_TIMESTAMP,published_at=CASE WHEN $5='published' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id=$1 AND owner_id=$2 AND revision=$7 RETURNING *",
        [
          original.id,
          req.user.id,
          q.title,
          q.description,
          status,
          JSON.stringify(q.questions),
          original.revision,
        ],
      );
      if (!result.rows[0])
        throw new Problem(
          409,
          "This quiz changed in another tab. Reload before saving.",
        );
      res.json(fromRow(result.rows[0]));
    }),
  );
  app.post(
    "/api/quizzes/:id/duplicate",
    writes,
    auth.csrf,
    route(async (req, res) => {
      const q = await ownedQuiz(db, req.params.id, req.user.id);
      res.status(201).json(
        await insertQuiz(req.user.id, {
          ...q,
          title: `${q.title || "Untitled quiz"} (copy)`.slice(0, 180),
          questions: q.questions.map((q) => ({ ...q, id: randomUUID() })),
        }),
      );
    }),
  );
  app.delete(
    "/api/quizzes/:id",
    writes,
    auth.csrf,
    route(async (req, res) => {
      const q = await ownedQuiz(db, req.params.id, req.user.id);
      await db.query("DELETE FROM quizzes WHERE id=$1 AND owner_id=$2", [
        q.id,
        req.user.id,
      ]);
      res.json({ ok: true });
    }),
  );
  const io = new Server(httpServer, {
    maxHttpBufferSize: 20000,
    allowRequest: (req, done) => {
      const expected = appUrl
        ? new URL(appUrl).origin
        : `http://${req.headers.host}`;
      done(null, !req.headers.origin || req.headers.origin === expected);
    },
  });
  io.engine.use(auth.middleware);
  const engine = new GameEngine(io, db, auth);
  await engine.initialize();
  app.post(
    "/api/quizzes/:id/host",
    writes,
    auth.csrf,
    route(async (req, res) => {
      const g = await engine.create(req.user.id, req.params.id);
      res.status(201).json({ pin: g.pin });
    }),
  );
  app.get("/api/games", auth.requireUser, (req, res) =>
    res.json(
      [...engine.games.values()]
        .filter((g) => g.hostId === req.user.id)
        .map((g) => ({
          pin: g.pin,
          title: g.quiz.title,
          status: g.status,
          createdAt: g.createdAt,
        })),
    ),
  );
  app.get(
    "/health",
    route(async (_req, res) => {
      await db.query("SELECT 1");
      res.json({ status: "ok", version: "2.0.0" });
    }),
  );
  app.get("/join/:pin", (req, res) =>
    res.redirect("/?pin=" + encodeURIComponent(req.params.pin)),
  );
  const publicPath = path.join(__dirname, "public");
  const teacherPage = (req, res) =>
    req.user
      ? res.sendFile(path.join(publicPath, "platform.html"))
      : res.redirect("/login");
  app.get(
    ["/dashboard", "/account", "/quizzes/new", "/quizzes/:id/edit"],
    teacherPage,
  );
  app.get(["/signup", "/login"], (req, res) =>
    req.user
      ? res.redirect("/dashboard")
      : res.sendFile(path.join(publicPath, "platform.html")),
  );
  app.get(["/teacher", "/teacher.html"], (req, res) =>
    req.user
      ? res.sendFile(path.join(publicPath, "teacher.html"))
      : res.redirect("/login"),
  );
  app.use(express.static(publicPath, { index: "index.html" }));
  app.use("/api", (_req, _res, next) => next(new Problem(404, "Not found.")));
  app.use((error, _req, res, _next) => {
    const status = error.status || 500;
    if (status >= 500)
      console.error("Request failed:", error.code || error.name);
    res.status(status).json({
      message:
        status >= 500
          ? "The service is temporarily unavailable. Please retry."
          : error.message,
      details: error.details,
    });
  });
  return {
    app,
    httpServer,
    io,
    db,
    engine,
    async close() {
      await engine.close();
      await new Promise((resolve) => io.close(resolve));
      httpServer.closeAllConnections?.();
      if (!options.db) await db.close();
    },
  };
}
if (require.main === module)
  createApplication()
    .then((instance) => {
      const port = Number(process.env.PORT) || 3000;
      instance.httpServer.listen(port, "0.0.0.0", () =>
        console.log(`WordRush 2.0 listening on http://localhost:${port}`),
      );
      for (const signal of ["SIGTERM", "SIGINT"])
        process.once(signal, () =>
          instance.close().then(() => process.exit(0)),
        );
    })
    .catch((error) => {
      console.error("Startup failed:", error.message);
      process.exitCode = 1;
    });
module.exports = { createApplication };
