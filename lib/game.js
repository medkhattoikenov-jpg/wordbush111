"use strict";
// Extends the original teacher-controlled game with ownership, snapshots and explicit question identities.
const crypto = require("node:crypto");
const { Problem, ownedQuiz, requirePlayable } = require("./quizzes");
const digest = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
const fail = (message) => {
  throw new Problem(400, message);
};
class GameEngine {
  constructor(io, db, auth) {
    Object.assign(this, { io, db, auth });
    this.games = new Map();
    this.limits = new Map();
  }
  snapshot(g, runtime = false) {
    return {
      pin: g.pin,
      hostId: g.hostId,
      quizId: g.quizId,
      quiz: g.quiz,
      status: g.status,
      questionIndex: g.questionIndex,
      endsAt: g.endsAt,
      phaseId: g.phaseId,
      createdAt: g.createdAt,
      expiresAt: g.expiresAt,
      players: [...g.players].map(([key, p]) => [
        key,
        runtime
          ? structuredClone(p)
          : { ...p, connected: false, socketId: null },
      ]),
      ...(runtime ? { hostSocketId: g.hostSocketId } : {}),
    };
  }
  hydrate(data) {
    return {
      ...data,
      players: new Map(data.players),
      hostSocketId: data.hostSocketId || null,
      timer: null,
      queue: Promise.resolve(),
    };
  }
  async initialize() {
    await this.prune();
    for (const row of (
      await this.db.query(
        "SELECT snapshot FROM game_sessions WHERE expires_at>CURRENT_TIMESTAMP",
      )
    ).rows) {
      const g = this.hydrate(row.snapshot);
      this.games.set(g.pin, g);
      if (g.status === "question" && g.endsAt <= Date.now()) {
        this.transition(g, "reveal");
        await this.save(g);
      }
      this.schedule(g);
    }
    this.pruner = setInterval(
      () =>
        this.prune().catch(() => console.error("Retention cleanup failed.")),
      3600000,
    );
    this.pruner.unref();
    this.io.on("connection", (socket) => this.connection(socket));
  }
  async prune() {
    await this.db.query(
      "DELETE FROM auth_sessions WHERE expires_at<=CURRENT_TIMESTAMP",
    );
    await this.db.query(
      "DELETE FROM game_sessions WHERE expires_at<=CURRENT_TIMESTAMP",
    );
    for (const [pin, g] of this.games)
      if (g.expiresAt <= Date.now()) {
        clearTimeout(g.timer);
        this.games.delete(pin);
        this.emit(g, "game:expired", {
          message: "This game expired. Join a new room.",
        });
      }
  }
  async save(g) {
    await this.db.query(
      "INSERT INTO game_sessions(pin,host_id,quiz_id,snapshot,expires_at) VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT(pin) DO UPDATE SET snapshot=EXCLUDED.snapshot,expires_at=EXCLUDED.expires_at",
      [
        g.pin,
        g.hostId,
        g.quizId,
        JSON.stringify(this.snapshot(g)),
        new Date(g.expiresAt),
      ],
    );
  }
  async create(hostId, quizId) {
    const quiz = await ownedQuiz(this.db, quizId, hostId);
    requirePlayable(quiz);
    if (
      [...this.games.values()].filter(
        (g) =>
          g.hostId === hostId &&
          !["finished", "leaderboard"].includes(g.status),
      ).length >= 10
    )
      fail("Finish an existing game before hosting another.");
    let pin;
    do {
      pin = String(crypto.randomInt(100000, 1000000));
    } while (this.games.has(pin));
    const g = this.hydrate({
      pin,
      hostId,
      quizId,
      quiz: structuredClone(quiz),
      players: [],
      status: "lobby",
      questionIndex: -1,
      endsAt: null,
      phaseId: crypto.randomUUID(),
      createdAt: Date.now(),
      expiresAt: Date.now() + 86400000,
    });
    this.games.set(pin, g);
    try {
      await this.save(g);
    } catch (error) {
      this.games.delete(pin);
      throw error;
    }
    return g;
  }
  ranks(g) {
    return [...g.players.values()]
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.correctCount - a.correctCount ||
          a.joinedAt - b.joinedAt ||
          a.name.localeCompare(b.name),
      )
      .map((p, i) => ({
        rank: i + 1,
        name: p.name,
        score: p.score,
        correctCount: p.correctCount,
        answerCount: p.answerCount,
      }));
  }
  state(g, key, isHost) {
    const live = g.status === "question",
      score = (p) =>
        p.score - (live ? p.answers[g.questionIndex]?.points || 0 : 0);
    const s = {
      pin: g.pin,
      title: g.quiz.title,
      subtitle: g.quiz.description,
      status: g.status,
      phaseId: g.phaseId,
      questionIndex: g.questionIndex,
      totalQuestions: g.quiz.questions.length,
      serverTime: Date.now(),
      isHost,
      players: [...g.players.values()].map((p) => ({
        name: p.name,
        connected: p.connected,
        score: score(p),
        answered: Boolean(p.answers[g.questionIndex]),
        correctCount:
          p.correctCount -
          (live && p.answers[g.questionIndex]?.correct ? 1 : 0),
      })),
    };
    if (live || g.status === "reveal") {
      const q = g.quiz.questions[g.questionIndex];
      s.question = {
        id: q.id,
        type: q.type,
        prompt: q.prompt,
        options: q.options,
        number: g.questionIndex + 1,
        total: g.quiz.questions.length,
        duration: q.duration,
        endsAt: g.endsAt,
      };
      if (!live)
        s.reveal = {
          correct: q.correct,
          counts: q.options.map(
            (_, i) =>
              [...g.players.values()].filter(
                (p) => p.answers[g.questionIndex]?.selected === i,
              ).length,
          ),
        };
    }
    if (g.status === "podium") s.ranking = this.ranks(g).slice(0, 3);
    if (["leaderboard", "finished"].includes(g.status))
      s.ranking = this.ranks(g);
    if (!isHost) {
      const p = g.players.get(key),
        answer = p?.answers[g.questionIndex];
      s.me = p
        ? {
            name: p.name,
            score: score(p),
            lastAnswer: answer
              ? live
                ? { selected: answer.selected }
                : answer
              : null,
            rank: ["podium", "leaderboard", "finished"].includes(g.status)
              ? this.ranks(g).find((r) => r.name === p.name)?.rank
              : null,
          }
        : null;
    }
    return s;
  }
  emit(g, event = "game:state", payload) {
    const host = this.io.sockets.sockets.get(g.hostSocketId);
    if (host) host.emit(event, payload || this.state(g, null, true));
    for (const [key, p] of g.players) {
      const socket = this.io.sockets.sockets.get(p.socketId);
      if (socket) socket.emit(event, payload || this.state(g, key, false));
    }
  }
  schedule(g) {
    clearTimeout(g.timer);
    g.timer = null;
    if (this.closing || g.status !== "question") return;
    g.timer = setTimeout(
      () =>
        this.run(g, () => {
          if (g.status === "question") this.transition(g, "reveal");
        }).catch(() => {
          if (!this.closing) g.timer = setTimeout(() => this.schedule(g), 1000);
        }),
      Math.max(0, g.endsAt - Date.now()),
    );
    g.timer.unref();
  }
  run(g, work) {
    const pending = g.queue.then(async () => {
      if (this.closing || !this.games.has(g.pin))
        fail("This game is no longer available.");
      const before = this.snapshot(g, true);
      try {
        const result = await work();
        await this.save(g);
        this.schedule(g);
        this.emit(g);
        return result;
      } catch (error) {
        const restored = this.hydrate(before);
        Object.assign(g, { ...restored, queue: g.queue, timer: g.timer });
        this.schedule(g);
        throw error;
      }
    });
    g.queue = pending.catch(() => {});
    return pending;
  }
  transition(g, status) {
    g.status = status;
    g.phaseId = crypto.randomUUID();
  }
  nextQuestion(g) {
    g.questionIndex++;
    this.transition(g, "question");
    g.endsAt = Date.now() + g.quiz.questions[g.questionIndex].duration * 1000;
  }
  rate(key, max, window) {
    const now = Date.now();
    let entry = this.limits.get(key);
    if (!entry || entry.until <= now) {
      entry = { count: 0, until: now + window };
      this.limits.set(key, entry);
    }
    if (++entry.count > max)
      throw new Problem(429, "Too many attempts. Please wait and try again.");
    if (this.limits.size > 10000)
      for (const [id, v] of this.limits)
        if (v.until <= now) this.limits.delete(id);
  }
  async hostIdentity(socket) {
    const data = await new Promise((resolve, reject) =>
      this.auth.store.get(socket.request.sessionID || "", (error, value) =>
        error ? reject(error) : resolve(value),
      ),
    );
    if (
      !data?.passport?.user ||
      !this.auth.safeEqual(socket.handshake.auth?.csrfToken, data.csrf)
    )
      throw new Problem(401, "Please log in again to host this game.");
    return data.passport.user;
  }
  connection(socket) {
    const member = { pin: null, role: null, key: null };
    const on = (event, handler) =>
      socket.on(event, (payload, ack) => {
        Promise.resolve()
          .then(() => {
            this.rate(`socket:${socket.id}`, 160, 60000);
            if (
              !payload ||
              typeof payload !== "object" ||
              Array.isArray(payload)
            )
              fail("Invalid request. Refresh and try again.");
            return handler(payload);
          })
          .then(
            (result) => {
              if (typeof ack === "function") ack({ ok: true, ...result });
            },
            (error) => {
              if (!error.status)
                console.error(
                  "Socket event failed:",
                  event,
                  error.code || error.name,
                );
              if (typeof ack === "function")
                ack({
                  ok: false,
                  status: error.status || 503,
                  message: error.status
                    ? error.message
                    : "Unable to save the game. Please retry.",
                });
            },
          );
      });
    const gameFor = (pin) => {
      const g =
        typeof pin === "string" && /^\d{6}$/.test(pin)
          ? this.games.get(pin)
          : null;
      if (!g || g.expiresAt <= Date.now())
        fail("Game not found. Check the six-digit PIN.");
      return g;
    };
    const detach = async () => {
      const previous = this.games.get(member.pin);
      if (previous)
        await this.run(previous, () => {
          if (member.role === "player") {
            const p = previous.players.get(member.key);
            if (p?.socketId === socket.id) {
              if (previous.status === "lobby")
                previous.players.delete(member.key);
              else {
                p.connected = false;
                p.socketId = null;
              }
            }
          } else if (previous.hostSocketId === socket.id)
            previous.hostSocketId = null;
        });
      Object.assign(member, { pin: null, role: null, key: null });
    };
    on("host:create", async (payload) => {
      const user = await this.hostIdentity(socket);
      await detach();
      const g = await this.create(user, payload.quizId);
      g.hostSocketId = socket.id;
      Object.assign(member, { pin: g.pin, role: "host", key: user });
      this.emit(g);
      return { pin: g.pin };
    });
    on("host:resume", async (payload) => {
      const user = await this.hostIdentity(socket),
        g = gameFor(payload.pin);
      if (g.hostId !== user)
        throw new Problem(403, "You do not host this game.");
      if (member.pin !== g.pin || member.role !== "host") await detach();
      await this.run(g, () => {
        g.hostSocketId = socket.id;
        Object.assign(member, { pin: g.pin, role: "host", key: user });
      });
      return { pin: g.pin };
    });
    const hostAction = async (action, payload) => {
      const user = await this.hostIdentity(socket),
        g = gameFor(member.pin);
      return this.run(g, () => {
        if (
          member.role !== "host" ||
          g.hostId !== user ||
          g.hostSocketId !== socket.id
        )
          throw new Problem(403, "Not authorized as the host.");
        if (payload.phaseId !== g.phaseId)
          throw new Problem(
            409,
            "The game has moved on. Use the current controls.",
          );
        if (action === "start") {
          if (g.status !== "lobby") fail("The game already started.");
          if (![...g.players.values()].some((p) => p.connected))
            fail("Wait for at least one connected student.");
          this.nextQuestion(g);
        } else if (action === "end") this.transition(g, "finished");
        else if (g.status === "question") this.transition(g, "reveal");
        else if (g.status === "reveal") {
          if (g.questionIndex + 1 < g.quiz.questions.length)
            this.nextQuestion(g);
          else this.transition(g, "podium");
        } else if (g.status === "podium") this.transition(g, "leaderboard");
        else if (g.status === "leaderboard") this.transition(g, "finished");
        else fail("Nothing to advance yet.");
      });
    };
    on("host:start", (p) => hostAction("start", p));
    on("host:next", (p) => hostAction("next", p));
    on("host:end", (p) => hostAction("end", p));
    on("player:join", async (payload) => {
      this.rate(`join:${socket.handshake.address}`, 300, 600000);
      const g = gameFor(payload.pin);
      const name =
        typeof payload.name === "string"
          ? payload.name
              .normalize("NFKC")
              .replace(/[<>\p{Cc}\p{Cf}]/gu, "")
              .trim()
              .slice(0, 24)
              .trim()
          : "";
      if (name.length < 2) fail("Enter a nickname of 2–24 characters.");
      if (/\b(fuck|shit|bitch|asshole)\b/i.test(name))
        fail("Choose a classroom-friendly nickname.");
      if (member.role === "player" && member.pin === g.pin)
        fail("You already joined. Resume or leave your current game first.");
      if (member.pin) await detach();
      return this.run(g, () => {
        if (g.status !== "lobby") fail("This game has already started.");
        if (g.players.size >= 80) fail("This game is full (80 students).");
        if (
          [...g.players.values()].some(
            (p) => p.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
          )
        )
          fail("That name is taken. Choose another.");
        const playerToken = crypto.randomBytes(24).toString("hex"),
          key = digest(playerToken);
        g.players.set(key, {
          name,
          socketId: socket.id,
          connected: true,
          joinedAt: Date.now(),
          score: 0,
          correctCount: 0,
          answerCount: 0,
          answers: {},
        });
        Object.assign(member, { pin: g.pin, role: "player", key });
        return { pin: g.pin, playerToken, name };
      });
    });
    on("player:resume", async (payload) => {
      const g = gameFor(payload.pin);
      if (
        typeof payload.playerToken !== "string" ||
        !/^[a-f0-9]{48}$/.test(payload.playerToken)
      )
        fail("Previous session not found. Join a new game.");
      const key = digest(payload.playerToken);
      if (!g.players.has(key))
        fail("Previous session not found. Join a new game.");
      if (member.pin && (member.pin !== g.pin || member.key !== key))
        await detach();
      return this.run(g, () => {
        const p = g.players.get(key);
        p.connected = true;
        p.socketId = socket.id;
        Object.assign(member, { pin: g.pin, role: "player", key });
        return { pin: g.pin, name: p.name };
      });
    });
    on("player:leave", async () => {
      await detach();
      return {};
    });
    on("player:answer", (payload) => {
      const g = gameFor(member.pin);
      return this.run(g, () => {
        const p = g.players.get(member.key);
        if (member.role !== "player" || !p || p.socketId !== socket.id)
          throw new Problem(403, "Resume your player session first.");
        if (g.status !== "question" || Date.now() >= g.endsAt)
          fail("Answer window has closed.");
        const q = g.quiz.questions[g.questionIndex];
        if (payload.questionId !== q.id || payload.phaseId !== g.phaseId)
          fail("This answer belongs to a different question.");
        if (p.answers[g.questionIndex]) fail("Answer already submitted.");
        if (
          !Number.isInteger(payload.selected) ||
          payload.selected < 0 ||
          payload.selected >= q.options.length
        )
          fail("Invalid answer.");
        const correct = payload.selected === q.correct,
          points = correct
            ? Math.round(
                500 +
                  (500 * Math.max(0, g.endsAt - Date.now())) /
                    (q.duration * 1000),
              )
            : 0;
        p.answers[g.questionIndex] = {
          selected: payload.selected,
          correct,
          points,
          submittedAt: Date.now(),
        };
        p.score += points;
        p.answerCount++;
        if (correct) p.correctCount++;
        if (
          [...g.players.values()].every(
            (player) => player.answers[g.questionIndex],
          )
        )
          this.transition(g, "reveal");
        return { selected: payload.selected };
      });
    });
    socket.on("disconnect", () => {
      const g = this.games.get(member.pin);
      if (!g || this.closing) return;
      this.run(g, () => {
        if (member.role === "player") {
          const p = g.players.get(member.key);
          if (p?.socketId === socket.id) {
            p.connected = false;
            p.socketId = null;
          }
        } else if (g.hostSocketId === socket.id) g.hostSocketId = null;
      }).catch(() => {});
    });
  }
  async close() {
    this.closing = true;
    clearInterval(this.pruner);
    for (const g of this.games.values()) clearTimeout(g.timer);
    await Promise.all([...this.games.values()].map((g) => g.queue));
  }
}
module.exports = { GameEngine };
