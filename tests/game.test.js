"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { io: client } = require("socket.io-client");
const { createApplication } = require("../server");
const { openDatabase } = require("../lib/db");
let instance, base;
const sockets = [];
const password = "classroom-test-password-2026";
class Browser {
  constructor() {
    this.cookie = "";
    this.csrfToken = "";
  }
  async request(url, method = "GET", body, extra = {}) {
    const response = await fetch(base + url, {
      method,
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        Cookie: this.cookie,
        ...(method !== "GET" ? { "X-CSRF-Token": this.csrfToken } : {}),
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const cookie = response.headers.get("set-cookie");
    if (cookie) this.cookie = cookie.split(";")[0];
    const data = await response.json().catch(() => ({}));
    if (data.csrfToken) this.csrfToken = data.csrfToken;
    return { status: response.status, data, headers: response.headers };
  }
  async initialize() {
    return this.request("/api/session");
  }
  async signup(label) {
    this.email = `${label.toLowerCase().replace(/\W/g, "-")}-${randomUUID()}@example.com`;
    await this.initialize();
    return this.request("/api/auth/signup", "POST", {
      name: label,
      email: this.email,
      password,
      confirmPassword: password,
    });
  }
  async login() {
    await this.initialize();
    return this.request("/api/auth/login", "POST", {
      email: this.email,
      password,
    });
  }
}
const q = (type = "multiple-choice", index = 0) => ({
  id: randomUUID(),
  type,
  prompt: `Question ${index + 1}`,
  options:
    type === "true-false" ? ["True", "False"] : ["One", "Two", "Three", "Four"],
  correct: index % (type === "true-false" ? 2 : 4),
  duration: 20,
});
async function connect(browser) {
  const socket = client(base, {
    transports: ["websocket"],
    reconnection: false,
    auth: browser ? { csrfToken: browser.csrfToken } : {},
    extraHeaders: browser ? { Cookie: browser.cookie } : {},
  });
  sockets.push(socket);
  socket.on("game:state", (state) => {
    socket.latest = state;
  });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  return socket;
}
const emit = (s, event, body = {}) =>
  new Promise((resolve, reject) =>
    s
      .timeout(5000)
      .emit(event, body, (error, result) =>
        error ? reject(error) : resolve(result),
      ),
  );
async function waitState(socket, predicate, timeout = 4000) {
  if (socket.latest && predicate(socket.latest)) return socket.latest;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("game:state", listener);
      reject(Error("State timeout"));
    }, timeout);
    const listener = (state) => {
      if (predicate(state)) {
        clearTimeout(timer);
        socket.off("game:state", listener);
        resolve(state);
      }
    };
    socket.on("game:state", listener);
  });
}
before(async () => {
  instance = await createApplication({
    test: true,
    database: { dataDir: "memory://" },
    secret: "a-test-session-secret-at-least-32-characters",
  });
  await new Promise((r) => instance.httpServer.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${instance.httpServer.address().port}`;
});
after(async () => {
  for (const socket of sockets) socket.disconnect();
  await instance.close();
});

test("signup, duplicate email, login, protected routes, CSRF, logout and expired session", async () => {
  const teacher = new Browser();
  assert.equal((await teacher.request("/api/quizzes")).status, 401);
  assert.equal((await teacher.signup("Teacher auth")).status, 201);
  const teacherRow = (
    await instance.db.query("SELECT * FROM teachers WHERE email=$1", [
      teacher.email,
    ])
  ).rows[0];
  assert.ok(teacherRow.password_hash.startsWith("$2"));
  assert.notEqual(teacherRow.password_hash, password);
  assert.match(teacher.cookie, /wordrush.sid/);
  const other = new Browser();
  await other.initialize();
  assert.equal(
    (
      await other.request("/api/auth/signup", "POST", {
        name: "Duplicate",
        email: teacher.email,
        password,
        confirmPassword: password,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await teacher.request(
        "/api/quizzes",
        "POST",
        { title: "No CSRF", questions: [] },
        { "X-CSRF-Token": "wrong" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await teacher.request(
        "/api/quizzes",
        "POST",
        { title: "Bad origin", questions: [] },
        { Origin: "https://evil.example" },
      )
    ).status,
    403,
  );
  const oldCookie = teacher.cookie;
  assert.equal(
    (await teacher.request("/api/auth/logout", "POST", {})).status,
    200,
  );
  teacher.cookie = oldCookie;
  assert.equal((await teacher.request("/api/quizzes")).status, 401);
  await teacher.initialize();
  assert.equal(
    (
      await teacher.request("/api/auth/login", "POST", {
        email: teacher.email,
        password: "incorrect-password",
      })
    ).status,
    401,
  );
  assert.equal((await teacher.login()).status, 200);
  await instance.db.query("UPDATE auth_sessions SET expires_at=$1", [
    new Date(0),
  ]);
  assert.equal((await teacher.request("/api/quizzes")).status, 401);
});
test("private quiz CRUD, incomplete drafts, publish, duplicate, reorder, 250 questions and ownership", async () => {
  const a = new Browser(),
    b = new Browser();
  await a.signup("Owner");
  await b.signup("Other owner");
  const created = await a.request("/api/quizzes", "POST", {
    title: "",
    description: "",
    questions: [{ ...q(), prompt: "", correct: null }],
  });
  assert.equal(created.status, 201);
  let quiz = created.data;
  assert.equal((await b.request(`/api/quizzes/${quiz.id}`)).status, 404);
  assert.equal(
    (await b.request(`/api/quizzes/${quiz.id}`, "DELETE", {})).status,
    404,
  );
  assert.equal(
    (await b.request(`/api/quizzes/${quiz.id}`, "PUT", quiz)).status,
    404,
  );
  assert.equal(
    (await b.request(`/api/quizzes/${quiz.id}/host`, "POST", {})).status,
    404,
  );
  assert.equal((await b.request("/api/quizzes")).data.length, 0);
  assert.equal(
    (
      await a.request(`/api/quizzes/${quiz.id}`, "PUT", {
        ...quiz,
        status: "published",
      })
    ).status,
    422,
  );
  assert.equal(
    (await a.request(`/api/quizzes/${quiz.id}/host`, "POST", {})).status,
    422,
  );
  const first = q(),
    second = q("true-false", 1);
  let saved = await a.request(`/api/quizzes/${quiz.id}`, "PUT", {
    ...quiz,
    title: "Edited quiz",
    questions: [second, first],
    status: "draft",
  });
  assert.equal(saved.status, 200);
  quiz = saved.data;
  assert.deepEqual(
    quiz.questions.map((q) => q.id),
    [second.id, first.id],
  );
  assert.equal(
    (await a.request(`/api/quizzes/${quiz.id}/host`, "POST", {})).status,
    201,
  );
  saved = await a.request(`/api/quizzes/${quiz.id}`, "PUT", {
    ...quiz,
    status: "published",
  });
  assert.equal(saved.status, 200);
  quiz = saved.data;
  assert.equal(
    (
      await a.request(`/api/quizzes/${quiz.id}`, "PUT", {
        ...quiz,
        revision: 1,
      })
    ).status,
    409,
  );
  const duplicate = await a.request(
    `/api/quizzes/${quiz.id}/duplicate`,
    "POST",
    {},
  );
  assert.equal(duplicate.status, 201);
  assert.equal(duplicate.data.status, "draft");
  assert.notEqual(duplicate.data.questions[0].id, second.id);
  assert.equal(
    (await a.request(`/api/quizzes/${duplicate.data.id}`, "DELETE", {})).status,
    200,
  );
  assert.equal(
    (
      await a.request("/api/quizzes", "POST", {
        title: "Long quiz",
        questions: Array.from({ length: 250 }, (_, i) =>
          q("multiple-choice", i),
        ),
      })
    ).status,
    201,
  );
  const sample = await a.request("/api/quizzes/import-sample", "POST", {});
  assert.equal(sample.status, 201);
  assert.equal(sample.data.questions.length, 20);
  assert.equal((await b.request(`/api/quizzes/${sample.data.id}`)).status, 404);
});
test("complete eight-question classroom, both types, three students, snapshots, scores and separate results", async () => {
  const teacher = new Browser(),
    outsider = new Browser();
  await teacher.signup("Teacher A");
  await outsider.signup("Teacher B");
  const questions = [
    ...Array.from({ length: 5 }, (_, i) => q("multiple-choice", i)),
    ...Array.from({ length: 3 }, (_, i) => q("true-false", i)),
  ];
  let quiz = (
    await teacher.request("/api/quizzes", "POST", {
      title: "English Vocabulary Test",
      description: "Acceptance scenario",
      questions,
    })
  ).data;
  await teacher.request("/api/auth/logout", "POST", {});
  assert.equal((await teacher.login()).status, 200);
  assert.equal(
    (await teacher.request(`/api/quizzes/${quiz.id}`)).data.questions.length,
    8,
  );
  quiz = (
    await teacher.request(`/api/quizzes/${quiz.id}`, "PUT", {
      ...quiz,
      status: "published",
    })
  ).data;
  const pin = (
    await teacher.request(`/api/quizzes/${quiz.id}/host`, "POST", {})
  ).data.pin;
  assert.match(pin, /^\d{6}$/);
  const host = await connect(teacher),
    badHost = await connect(outsider);
  assert.equal((await emit(badHost, "host:resume", { pin })).ok, false);
  const otherQuiz = (
    await outsider.request("/api/quizzes", "POST", {
      title: "Teacher B's independent game",
      questions: [q("true-false")],
    })
  ).data;
  const otherPin = (
    await outsider.request(`/api/quizzes/${otherQuiz.id}/host`, "POST", {})
  ).data.pin;
  assert.notEqual(otherPin, pin);
  assert.equal(
    (await emit(badHost, "host:resume", { pin: otherPin })).ok,
    true,
  );
  const otherStudent = await connect();
  assert.equal(
    (await emit(otherStudent, "player:join", { pin: otherPin, name: "Alice" }))
      .ok,
    true,
  );
  assert.equal((await emit(host, "host:resume", { pin })).ok, true);
  assert.equal(
    (await emit(host, "host:start", { phaseId: host.latest.phaseId })).ok,
    false,
  );
  const players = await Promise.all([connect(), connect(), connect()]);
  assert.equal((await emit(players[0], "player:join", null)).ok, false);
  assert.equal(
    (await emit(players[0], "player:join", { pin: "000000", name: "Alice" }))
      .ok,
    false,
  );
  const identities = [];
  for (let i = 0; i < 3; i++)
    identities.push(
      await emit(players[i], "player:join", {
        pin,
        name: ["Alice", "Bob", "Cara"][i],
      }),
    );
  assert.equal(
    (await emit(players[0], "player:join", { pin, name: "Phantom" })).ok,
    false,
  );
  const duplicate = await connect();
  assert.equal(
    (await emit(duplicate, "player:join", { pin, name: "ALICE" })).ok,
    false,
  );
  assert.equal(
    (await emit(players[0], "host:start", { phaseId: host.latest.phaseId })).ok,
    false,
  );
  const originalPhase = host.latest.phaseId;
  assert.equal(
    (await emit(host, "host:start", { phaseId: originalPhase })).ok,
    true,
  );
  assert.equal(
    (await emit(host, "host:start", { phaseId: originalPhase })).ok,
    false,
  );
  await waitState(players[0], (s) => s.status === "question");
  assert.equal(badHost.latest.status, "lobby");
  assert.equal(
    (await emit(badHost, "host:start", { phaseId: badHost.latest.phaseId })).ok,
    true,
  );
  assert.equal(host.latest.pin, pin);
  assert.equal(badHost.latest.pin, otherPin);
  assert.equal(new Set(players.map((s) => s.latest.question.endsAt)).size, 1);
  // Editing the saved quiz does not affect the active immutable snapshot.
  await teacher.request(`/api/quizzes/${quiz.id}`, "PUT", {
    ...quiz,
    title: "Changed outside game",
    questions: [q()],
    status: "draft",
  });
  assert.equal(instance.engine.games.get(pin).quiz.questions.length, 8);
  for (let i = 0; i < 8; i++) {
    await waitState(
      host,
      (s) => s.status === "question" && s.questionIndex === i,
    );
    await Promise.all(
      players.map((player) =>
        waitState(
          player,
          (s) => s.status === "question" && s.questionIndex === i,
        ),
      ),
    );
    const state = host.latest,
      question = state.question,
      phaseId = state.phaseId;
    assert.equal(question.options.length, i < 5 ? 4 : 2);
    assert.equal(players[0].latest.reveal, undefined);
    assert.equal(question.correct, undefined);
    assert.equal(
      (
        await emit(players[0], "player:answer", {
          selected: 0,
          questionId: "outdated",
          phaseId,
        })
      ).ok,
      false,
    );
    assert.equal(
      (
        await emit(players[0], "player:answer", {
          selected: 99,
          questionId: question.id,
          phaseId,
        })
      ).ok,
      false,
    );
    for (let j = 0; j < 3; j++) {
      const selected =
        j === 1
          ? (questions[i].correct + 1) % question.options.length
          : questions[i].correct;
      assert.equal(
        (
          await emit(players[j], "player:answer", {
            selected,
            questionId: question.id,
            phaseId,
          })
        ).ok,
        true,
      );
      if (j === 0) {
        assert.equal(players[0].latest.me.lastAnswer.correct, undefined);
        assert.equal(
          (
            await emit(players[j], "player:answer", {
              selected,
              questionId: question.id,
              phaseId,
            })
          ).ok,
          false,
        );
      }
    }
    await waitState(host, (s) => s.status === "reveal");
    assert.equal(host.latest.reveal.correct, questions[i].correct);
    assert.equal(
      (await emit(host, "host:next", { phaseId: host.latest.phaseId })).ok,
      true,
    );
  }
  await waitState(host, (s) => s.status === "podium");
  assert.equal(host.latest.ranking.length, 3);
  assert.equal(host.latest.ranking[2].name, "Bob");
  assert.equal(host.latest.ranking.find((p) => p.name === "Bob").score, 0);
  assert.equal(
    host.latest.ranking.find((p) => p.name === "Alice").correctCount,
    8,
  );
  const phase = host.latest.phaseId;
  assert.equal((await emit(host, "host:next", { phaseId: phase })).ok, true);
  assert.equal((await emit(host, "host:next", { phaseId: phase })).ok, false);
  await waitState(host, (s) => s.status === "leaderboard");
  const resumed = await connect();
  assert.equal(
    (
      await emit(resumed, "player:resume", {
        pin,
        playerToken: identities[0].playerToken,
      })
    ).ok,
    true,
  );
  assert.equal(resumed.latest.me.rank <= 2, true);
  assert.equal(resumed.latest.me.score >= 4000, true);
  assert.equal(
    (
      await emit(players[0], "player:answer", {
        selected: 0,
        questionId: questions[0].id,
        phaseId: phase,
      })
    ).ok,
    false,
  );
  assert.equal(
    (await emit(host, "host:next", { phaseId: host.latest.phaseId })).ok,
    true,
  );
  await waitState(host, (s) => s.status === "finished");
  await teacher.request("/api/auth/logout", "POST", {});
  assert.equal(
    (await emit(host, "host:end", { phaseId: host.latest.phaseId })).ok,
    false,
  );
});
test("timer expiry, safe leave, stale actions, independent games and one-person podium", async () => {
  const teacher = new Browser();
  await teacher.signup("Timer teacher");
  const quiz = (
    await teacher.request("/api/quizzes", "POST", {
      title: "Timer quiz",
      questions: [{ ...q("true-false"), duration: 5 }],
    })
  ).data;
  const pin = (
    await teacher.request(`/api/quizzes/${quiz.id}/host`, "POST", {})
  ).data.pin;
  const second = (
    await teacher.request(`/api/quizzes/${quiz.id}/host`, "POST", {})
  ).data.pin;
  assert.notEqual(pin, second);
  // Active rooms retain their immutable copy even after the source quiz is deleted.
  assert.equal(
    (await teacher.request(`/api/quizzes/${quiz.id}`, "DELETE", {})).status,
    200,
  );
  const host = await connect(teacher),
    player = await connect();
  await emit(host, "host:resume", { pin });
  await emit(player, "player:join", { pin, name: "Leaving" });
  assert.equal((await emit(player, "player:leave")).ok, true);
  assert.equal(instance.engine.games.get(pin).players.size, 0);
  await emit(player, "player:join", { pin, name: "Timer student" });
  await emit(host, "host:start", { phaseId: host.latest.phaseId });
  assert.equal(instance.engine.games.get(second).status, "lobby");
  const deadline = host.latest.question.endsAt;
  await waitState(host, (s) => s.status === "reveal", 7000);
  assert.ok(Date.now() >= deadline);
  assert.equal(
    (
      await emit(player, "player:answer", {
        selected: 0,
        questionId: quiz.questions[0].id,
        phaseId: host.latest.phaseId,
      })
    ).ok,
    false,
  );
  await emit(host, "host:next", { phaseId: host.latest.phaseId });
  assert.equal(host.latest.status, "podium");
  assert.equal(host.latest.ranking.length, 1);
  await emit(host, "host:next", { phaseId: host.latest.phaseId });
  assert.equal(host.latest.status, "leaderboard");
});
test("persistent accounts, sessions, quizzes and live room recover after database/server reopen", async () => {
  const fs = require("node:fs"),
    path = require("node:path");
  const parent = path.resolve(".audit");
  fs.mkdirSync(parent, { recursive: true });
  const folder = fs.mkdtempSync(path.join(parent, "restart-test-"));
  let app,
    oldBase = base;
  try {
    app = await createApplication({
      test: true,
      database: { dataDir: folder },
      secret: "persistent-test-secret-with-more-than-32-characters",
    });
    await new Promise((r) => app.httpServer.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${app.httpServer.address().port}`;
    const teacher = new Browser();
    await teacher.signup("Persistent teacher");
    const quiz = (
      await teacher.request("/api/quizzes", "POST", {
        title: "Persisted",
        questions: [q(), q("true-false")],
      })
    ).data;
    const pin = (
      await teacher.request(`/api/quizzes/${quiz.id}/host`, "POST", {})
    ).data.pin;
    const host = await connect(teacher),
      player = await connect();
    await emit(host, "host:resume", { pin });
    const identity = await emit(player, "player:join", {
      pin,
      name: "Returning student",
    });
    await emit(host, "host:start", { phaseId: host.latest.phaseId });
    await emit(player, "player:answer", {
      questionId: host.latest.question.id,
      phaseId: host.latest.phaseId,
      selected: quiz.questions[0].correct,
    });
    const score = player.latest.me.score;
    await app.close();
    app = null;
    app = await createApplication({
      test: true,
      database: { dataDir: folder },
      secret: "persistent-test-secret-with-more-than-32-characters",
    });
    await new Promise((r) => app.httpServer.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${app.httpServer.address().port}`;
    assert.equal(
      (await teacher.request("/api/session")).data.user.name,
      "Persistent teacher",
    );
    assert.equal(
      (await teacher.request(`/api/quizzes/${quiz.id}`)).data.questions.length,
      2,
    );
    const newHost = await connect(teacher),
      newPlayer = await connect();
    assert.equal((await emit(newHost, "host:resume", { pin })).ok, true);
    assert.equal(
      (
        await emit(newPlayer, "player:resume", {
          pin,
          playerToken: identity.playerToken,
        })
      ).ok,
      true,
    );
    assert.equal(newPlayer.latest.me.score, score);
    assert.equal(newPlayer.latest.status, "reveal");
    assert.equal(
      (
        await emit(newPlayer, "player:answer", {
          selected: 0,
          questionId: quiz.questions[0].id,
          phaseId: newPlayer.latest.phaseId,
        })
      ).ok,
      false,
    );
  } finally {
    if (app) await app.close();
    base = oldBase;
    assert.ok(folder.startsWith(parent + path.sep));
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
