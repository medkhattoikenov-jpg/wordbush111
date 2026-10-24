"use strict";
const session = require("express-session");
const { Passport } = require("passport");
const { Strategy } = require("passport-local");
const bcrypt = require("bcryptjs");
const { randomBytes, timingSafeEqual } = require("node:crypto");
const { Problem } = require("./quizzes");
const safeEqual = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const publicUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  createdAt: user.created_at,
});
class DatabaseSessionStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;
  }
  get(sid, callback) {
    this.db
      .query(
        "SELECT data FROM auth_sessions WHERE sid=$1 AND expires_at>CURRENT_TIMESTAMP",
        [sid],
      )
      .then((result) => callback(null, result.rows[0]?.data || null), callback);
  }
  set(sid, data, callback = () => {}) {
    const expires = new Date(data.cookie.expires || Date.now() + 7 * 86400000);
    this.db
      .query(
        "INSERT INTO auth_sessions(sid,data,expires_at) VALUES($1,$2::jsonb,$3) ON CONFLICT(sid) DO UPDATE SET data=EXCLUDED.data,expires_at=EXCLUDED.expires_at",
        [sid, JSON.stringify(data), expires],
      )
      .then(() => callback(), callback);
  }
  touch(sid, data, callback = () => {}) {
    this.db
      .query("UPDATE auth_sessions SET expires_at=$2 WHERE sid=$1", [
        sid,
        new Date(data.cookie.expires),
      ])
      .then(() => callback(), callback);
  }
  destroy(sid, callback = () => {}) {
    this.db
      .query("DELETE FROM auth_sessions WHERE sid=$1", [sid])
      .then(() => callback(), callback);
  }
}
async function setupAuth(app, db, config) {
  const store = new DatabaseSessionStore(db);
  const middleware = session({
    name: "wordrush.sid",
    secret: config.secret,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: config.production,
      maxAge: 7 * 86400000,
    },
  });
  const passport = new Passport();
  const dummyHash = await bcrypt.hash(randomBytes(32).toString("hex"), 12);
  passport.use(
    new Strategy({ usernameField: "email" }, async (email, password, done) => {
      try {
        const result = await db.query("SELECT * FROM teachers WHERE email=$1", [
          String(email).trim().toLowerCase(),
        ]);
        const user = result.rows[0];
        const matches =
          typeof password === "string" &&
          Buffer.byteLength(password) <= 72 &&
          (await bcrypt.compare(password, user?.password_hash || dummyHash));
        done(null, matches && user ? publicUser(user) : false);
      } catch (error) {
        done(error);
      }
    }),
  );
  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id, done) => {
    try {
      const result = await db.query(
        "SELECT id,name,email,created_at FROM teachers WHERE id=$1",
        [id],
      );
      done(null, result.rows[0] ? publicUser(result.rows[0]) : false);
    } catch (error) {
      done(error);
    }
  });
  app.use(middleware, passport.initialize(), passport.session());
  const csrfToken = (req) =>
    req.session.csrf || (req.session.csrf = randomBytes(32).toString("hex"));
  const csrf = (req, _res, next) => {
    if (!safeEqual(req.get("x-csrf-token"), req.session.csrf))
      return next(
        new Problem(403, "Your page session changed. Refresh and try again."),
      );
    const origin = req.get("origin");
    if (origin && origin !== config.origin(req))
      return next(new Problem(403, "Request origin is not allowed."));
    next();
  };
  const requireUser = (req, _res, next) =>
    req.user ? next() : next(new Problem(401, "Please log in to continue."));
  return { middleware, store, passport, csrf, csrfToken, requireUser };
}
module.exports = { setupAuth, safeEqual, publicUser };
