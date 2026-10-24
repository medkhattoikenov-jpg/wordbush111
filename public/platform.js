"use strict";
const root = document.getElementById("platform"),
  h = WR.html;
let quiz = null,
  selected = 0,
  dirty = false,
  version = 0,
  saving = null,
  autosave = null;
const path = location.pathname;
const newQuestion = (type = "multiple-choice") => ({
  id: crypto.randomUUID(),
  type,
  prompt: "",
  options: type === "true-false" ? ["True", "False"] : ["", "", "", ""],
  correct: null,
  duration: 20,
});
function message(text, isError = false) {
  const el = document.getElementById("page-message");
  if (el) {
    el.textContent = text || "";
    el.classList.toggle("is-error", isError);
  }
}
function shell(content, active = "quizzes") {
  root.innerHTML = `<aside class="studio-sidebar"><a class="logo" href="/dashboard"><span class="logo-mark">W</span>WORD<span>RUSH</span><span class="logo-dot">.</span></a><div class="studio-label">TEACHER STUDIO</div><nav aria-label="Main navigation"><a class="${active === "quizzes" ? "active" : ""}" href="/dashboard"><span>▦</span> My quizzes</a><a href="/quizzes/new"><span>＋</span> Create quiz</a><a class="${active === "account" ? "active" : ""}" href="/account"><span>◎</span> My account</a></nav><div class="sidebar-note"><span>✦</span><strong>A little competition.<br>A lot of learning.</strong><p>Your next great class starts here.</p></div><div class="sidebar-user"><span class="avatar">${h(WR.session.user.name[0].toUpperCase())}</span><div><strong>${h(WR.session.user.name)}</strong><small>Teacher</small></div><button id="logout" class="icon-button" aria-label="Log out" title="Log out">↗</button></div></aside><main class="studio-main">${content}</main>`;
  document.getElementById("logout").onclick = () => {
    if (dirty && !confirm("Your latest changes are not saved. Log out anyway?"))
      return;
    WR.logout().catch((e) => message(e.message, true));
  };
}
function authPage() {
  const signup = path === "/signup";
  root.innerHTML = `<div class="auth-layout"><section class="auth-story"><a class="logo" href="/"><span class="logo-mark">W</span>WORD<span>RUSH</span><span class="logo-dot">.</span></a><div class="eyebrow">LESS PREP. MORE LIGHTBULB MOMENTS.</div><h1>Make your<br>classroom<br><span class="gradient-text">come alive.</span></h1><p>Create a quiz. Share a PIN. Let curiosity do the rest.</p><div class="story-tiles"><span>◆ Create your own quizzes</span><span>⚡ Play together, in real time</span><span>🏆 Celebrate every learner</span></div><a href="/" class="student-link">Joining as a student? Enter a game PIN →</a></section><section class="auth-form-area"><form class="panel auth-panel" id="auth-form"><div class="tiny-cap">YOUR CLASSROOM STARTS HERE</div><h2>${signup ? "Create your account" : "Welcome back."}</h2><p>${signup ? "A space for your quizzes and your next great lesson." : "Good to see you. Let’s get your next game ready."}</p>${signup ? '<label for="display-name">DISPLAY NAME</label><input id="display-name" name="name" autocomplete="name" minlength="2" maxlength="80" placeholder="What should we call you?" required>' : ""}<label for="email">EMAIL ADDRESS</label><input id="email" name="email" type="email" autocomplete="email" maxlength="254" placeholder="you@school.com" required><label for="password">PASSWORD</label><input id="password" name="password" type="password" autocomplete="${signup ? "new-password" : "current-password"}" ${signup ? 'minlength="12"' : ""} placeholder="${signup ? "At least 12 characters" : "Your password"}" required>${signup ? '<label for="confirm-password">CONFIRM PASSWORD</label><input id="confirm-password" name="confirmPassword" type="password" autocomplete="new-password" required>' : ""}<p class="form-message" id="page-message" role="alert"></p><button class="primary-button" id="auth-submit">${signup ? "CREATE ACCOUNT" : "LOG IN"} <span>→</span></button><div class="auth-switch">${signup ? 'Already have an account? <a href="/login">Log in</a>' : 'New to WordRush? <a href="/signup">Create an account</a>'}</div></form></section></div>`;
  document.getElementById("auth-form").onsubmit = async (event) => {
    event.preventDefault();
    const button = document.getElementById("auth-submit");
    button.disabled = true;
    message("");
    try {
      const form = new FormData(event.target);
      const result = await WR.request(
        `/api/auth/${signup ? "signup" : "login"}`,
        { method: "POST", body: Object.fromEntries(form) },
      );
      WR.session = result;
      location.href = "/dashboard";
    } catch (error) {
      message(error.message, true);
      button.disabled = false;
    }
  };
}
async function dashboard() {
  shell(
    `<header class="studio-heading"><div><div class="eyebrow">A FRESH ROUND OF POSSIBILITIES</div><h1>Hello, ${h(WR.session.user.name.split(" ")[0])}<span class="hello-dot">.</span></h1><p>Great lessons start with a little curiosity.</p></div><a href="/quizzes/new" class="primary-button compact">＋ Create new quiz</a></header><section class="dashboard-banner"><div><span class="banner-tag">YOUR CLASSROOM, REIMAGINED</span><h2>Ready. Set. WordRush.</h2><p>Your questions. Their phones. One unforgettable lesson.</p></div><div class="banner-art" aria-hidden="true"><span>◆</span><span>●</span><span>▲</span><span>■</span></div></section><section id="active-games"></section><div class="library-heading"><div><h2>My quizzes <span id="quiz-count" class="count-badge">0</span></h2><p>Keep your ideas close. Bring them to life.</p></div><div class="library-tools"><input type="search" id="search" aria-label="Search quizzes" placeholder="⌕  Search your quizzes"><select id="status-filter" aria-label="Filter quiz status"><option value="all">All quizzes</option><option value="draft">Drafts</option><option value="published">Published</option></select></div></div><p id="page-message" class="form-message" role="status"></p><section id="quiz-grid" class="quiz-grid"><p class="muted">Loading your quizzes…</p></section><div class="sample-prompt"><span>Need a starting point? Try the original 20-question Holidays quiz.</span><button class="text-button" id="import-sample">Add sample to my quizzes →</button></div>`,
  );
  const quizzes = await WR.request("/api/quizzes");
  const games = await WR.request("/api/games");
  const active = games.filter((g) => g.status !== "finished");
  if (active.length)
    document.getElementById("active-games").innerHTML =
      `<div class="active-games"><strong>Pick up where you left off</strong>${active.map((g) => `<a href="/teacher?pin=${h(g.pin)}">${h(g.title)} <span>${h(g.pin)} · ${h(g.status)}</span> ↗</a>`).join("")}</div>`;
  const render = () => {
    const search = document.getElementById("search").value.toLowerCase(),
      status = document.getElementById("status-filter").value;
    const filtered = quizzes.filter(
      (q) =>
        q.title.toLowerCase().includes(search) &&
        (status === "all" || q.status === status),
    );
    document.getElementById("quiz-count").textContent = quizzes.length;
    document.getElementById("quiz-grid").innerHTML = filtered.length
      ? filtered
          .map(
            (q, i) =>
              `<article class="quiz-card"><a href="/quizzes/${q.id}/edit" class="quiz-cover cover-${i % 4}"><span class="cover-decoration" aria-hidden="true">${["◆", "●", "▲", "■"][i % 4]}</span><span class="status-badge ${q.status}">${q.status === "published" ? "● Published" : "◐ Draft"}</span><span class="cover-caption">WORDRUSH ORIGINAL</span></a><div class="quiz-card-content"><h3><a href="/quizzes/${q.id}/edit">${h(q.title || "Untitled quiz")}</a></h3><p>${q.questionCount} question${q.questionCount === 1 ? "" : "s"} <span>·</span> ${new Date(q.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</p><div class="quiz-card-actions"><button class="host-button" data-host="${q.id}" ${q.playable ? "" : "disabled"} title="${q.playable ? "Host this quiz" : "Complete this quiz in the editor before hosting"}">▷ Host live</button><a href="/quizzes/${q.id}/edit" class="secondary-button small">Edit</a><details class="quiz-menu"><summary aria-label="More options for ${h(q.title || "Untitled quiz")}">⋯</summary><div><button data-duplicate="${q.id}">Duplicate</button><button data-toggle="${q.id}">${q.status === "published" ? "Unpublish" : "Publish"}</button><button data-delete="${q.id}" class="danger-text">Delete</button></div></details></div></div></article>`,
          )
          .join("")
      : `<div class="empty-state"><div>✦</div><h2>${quizzes.length ? "No matching quizzes" : "Your next great lesson starts here"}</h2><p>${quizzes.length ? "Try another search or filter." : "Create your first quiz, or add the sample to try a live game."}</p><a class="primary-button compact" href="/quizzes/new">＋ Create a quiz</a></div>`;
  };
  render();
  document.getElementById("search").oninput = render;
  document.getElementById("status-filter").onchange = render;
  document.getElementById("import-sample").onclick = async (event) => {
    event.target.disabled = true;
    try {
      const q = await WR.request("/api/quizzes/import-sample", {
        method: "POST",
        body: {},
      });
      location.href = `/quizzes/${q.id}/edit`;
    } catch (e) {
      message(e.message, true);
      event.target.disabled = false;
    }
  };
  document.getElementById("quiz-grid").onclick = async (event) => {
    const target = event.target.closest("button");
    if (!target) return;
    target.disabled = true;
    try {
      if (target.dataset.host) {
        const result = await WR.request(
          `/api/quizzes/${target.dataset.host}/host`,
          { method: "POST", body: {} },
        );
        location.href = `/teacher?pin=${result.pin}`;
      } else if (target.dataset.duplicate) {
        await WR.request(`/api/quizzes/${target.dataset.duplicate}/duplicate`, {
          method: "POST",
          body: {},
        });
        await dashboard();
      } else if (target.dataset.delete) {
        if (
          !confirm(
            "Delete this quiz? This cannot be undone. Active games keep their own copy.",
          )
        )
          return;
        await WR.request(`/api/quizzes/${target.dataset.delete}`, {
          method: "DELETE",
          body: {},
        });
        await dashboard();
      } else if (target.dataset.toggle) {
        const q = await WR.request(`/api/quizzes/${target.dataset.toggle}`);
        await WR.request(`/api/quizzes/${q.id}`, {
          method: "PUT",
          body: {
            ...q,
            status: q.status === "published" ? "draft" : "published",
          },
        });
        await dashboard();
      }
    } catch (e) {
      message(WR.errorText(e), true);
    } finally {
      target.disabled = false;
    }
  };
}
const backupKey = () => `wordrush:draft:${WR.session.user.id}:${quiz.id}`;
function markDirty() {
  dirty = true;
  version++;
  document.getElementById("save-status").textContent = "Unsaved changes";
  try {
    localStorage.setItem(backupKey(), JSON.stringify(quiz));
  } catch {
    message(
      "Local recovery is unavailable. Save your changes before closing this page.",
      true,
    );
  }
  clearTimeout(autosave);
  autosave = setTimeout(() => saveQuiz("draft").catch(() => {}), 1800);
}
async function saveQuiz(status = "draft") {
  clearTimeout(autosave);
  if (saving) {
    await saving;
    if (!dirty && quiz.status === status) return;
  }
  const savingVersion = version,
    body = structuredClone({ ...quiz, status });
  document.getElementById("save-status").textContent = "Saving…";
  saving = WR.request(`/api/quizzes/${quiz.id}`, { method: "PUT", body })
    .then((result) => {
      quiz.revision = result.revision;
      quiz.status = result.status;
      if (version === savingVersion) {
        dirty = false;
        localStorage.removeItem(backupKey());
        document.getElementById("save-status").textContent =
          status === "published"
            ? "Published · all changes saved"
            : "All changes saved";
        message(
          status === "published"
            ? "Published and ready to host. Your quiz stays private."
            : "",
        );
      } else {
        document.getElementById("save-status").textContent = "Unsaved changes";
        try {
          localStorage.setItem(backupKey(), JSON.stringify(quiz));
        } catch {}
        autosave = setTimeout(() => saveQuiz("draft").catch(() => {}), 1800);
      }
      document.getElementById("quiz-status-label").textContent = quiz.status;
    })
    .catch((error) => {
      dirty = true;
      document.getElementById("save-status").textContent = "Not saved";
      message(WR.errorText(error), true);
      if (error.status === 401)
        message(
          "Your session expired. Keep this tab open and log in in another tab, then reload to recover your local edits.",
          true,
        );
      throw error;
    })
    .finally(() => {
      saving = null;
    });
  return saving;
}
function renderQuestionList() {
  document.getElementById("question-count").textContent = quiz.questions.length;
  document.getElementById("question-list").innerHTML = quiz.questions
    .map(
      (q, i) =>
        `<button class="question-nav ${i === selected ? "selected" : ""}" data-question="${i}" aria-label="Edit question ${i + 1}"><span class="question-number">${i + 1}</span><span><strong>${h(q.prompt || "Untitled question")}</strong><small>${q.type === "true-false" ? "True / False" : "Multiple choice"} · ${q.duration}s</small></span><span>${q.type === "true-false" ? "◐" : "◆"}</span></button>`,
    )
    .join("");
  document.querySelectorAll("[data-question]").forEach(
    (button) =>
      (button.onclick = () => {
        selected = Number(button.dataset.question);
        renderQuestionList();
        renderQuestion();
      }),
  );
}
function renderQuestion() {
  const q = quiz.questions[selected],
    main = document.getElementById("question-editor");
  if (!q) {
    main.innerHTML =
      '<div class="empty-state"><div>＋</div><h2>What will you ask first?</h2><p>Add a question to start building your quiz.</p></div>';
    return;
  }
  main.innerHTML = `<div class="question-editor-top"><span class="tiny-cap">QUESTION ${selected + 1}</span><div class="question-settings"><label for="question-type">Type<select id="question-type"><option value="multiple-choice" ${q.type === "multiple-choice" ? "selected" : ""}>Multiple choice</option><option value="true-false" ${q.type === "true-false" ? "selected" : ""}>True / False</option></select></label><label for="question-duration">Time limit<select id="question-duration">${[
    ...new Set([5, 10, 15, 20, 30, 60, 90, 120, q.duration]),
  ]
    .sort((a, b) => a - b)
    .map(
      (n) =>
        `<option value="${n}" ${n === q.duration ? "selected" : ""}>${n} seconds</option>`,
    )
    .join(
      "",
    )}</select></label></div></div><label class="editor-field-label" for="question-prompt">${q.type === "true-false" ? "WRITE YOUR STATEMENT" : "WRITE YOUR QUESTION"}</label><textarea id="question-prompt" maxlength="600" placeholder="What would you like your students to know?">${h(q.prompt)}</textarea><div class="answer-editor-heading"><strong>Answer choices</strong><span>Select the circle next to the correct answer</span></div><div class="editor-answers ${q.type === "true-false" ? "binary" : ""}">${q.options.map((value, i) => `<div class="editor-answer answer-option-${i}"><span class="editor-answer-shape">${["◆", "▲", "●", "■"][i]}</span><label class="sr-only" for="answer-${i}">Answer ${i + 1}</label><input id="answer-${i}" data-option="${i}" maxlength="300" value="${h(value)}" placeholder="Add answer ${i + 1}" ${q.type === "true-false" ? "readonly" : ""}><input type="radio" class="correct-radio" name="correct-answer" data-correct="${i}" aria-label="Answer ${i + 1} is correct" ${q.correct === i ? "checked" : ""}></div>`).join("")}</div><div class="question-footer"><span>One question. One correct answer.</span><div><button class="secondary-button small" id="move-up" ${selected === 0 ? "disabled" : ""} aria-label="Move question up">↑</button><button class="secondary-button small" id="move-down" ${selected === quiz.questions.length - 1 ? "disabled" : ""} aria-label="Move question down">↓</button><button class="secondary-button small" id="duplicate-question">⧉ Duplicate</button><button class="text-button danger-text" id="delete-question">Delete</button></div></div>`;
  document.getElementById("question-prompt").oninput = (e) => {
    q.prompt = e.target.value;
    markDirty();
    renderQuestionList();
  };
  document.getElementById("question-duration").onchange = (e) => {
    q.duration = Number(e.target.value);
    markDirty();
    renderQuestionList();
  };
  document.querySelectorAll("[data-option]").forEach(
    (input) =>
      (input.oninput = () => {
        q.options[Number(input.dataset.option)] = input.value;
        markDirty();
      }),
  );
  document.querySelectorAll("[data-correct]").forEach(
    (input) =>
      (input.onchange = () => {
        q.correct = Number(input.dataset.correct);
        markDirty();
      }),
  );
  document.getElementById("question-type").onchange = (e) => {
    const type = e.target.value;
    if (
      type !== q.type &&
      q.options.some((v) => v.trim()) &&
      !confirm(
        "Switch question type? This replaces the answer choices and clears the correct answer.",
      )
    ) {
      e.target.value = q.type;
      return;
    }
    q.type = type;
    q.options = type === "true-false" ? ["True", "False"] : ["", "", "", ""];
    q.correct = null;
    markDirty();
    renderQuestionList();
    renderQuestion();
  };
  const move = (direction) => {
    const next = selected + direction;
    [quiz.questions[selected], quiz.questions[next]] = [
      quiz.questions[next],
      quiz.questions[selected],
    ];
    selected = next;
    markDirty();
    renderQuestionList();
    renderQuestion();
  };
  document.getElementById("move-up").onclick = () => move(-1);
  document.getElementById("move-down").onclick = () => move(1);
  document.getElementById("duplicate-question").onclick = () => {
    quiz.questions.splice(selected + 1, 0, {
      ...structuredClone(q),
      id: crypto.randomUUID(),
    });
    selected++;
    markDirty();
    renderQuestionList();
    renderQuestion();
  };
  document.getElementById("delete-question").onclick = () => {
    if (!confirm("Delete this question?")) return;
    quiz.questions.splice(selected, 1);
    selected = Math.max(0, selected - 1);
    markDirty();
    renderQuestionList();
    renderQuestion();
  };
}
async function editor() {
  if (path === "/quizzes/new") {
    quiz = await WR.request("/api/quizzes", {
      method: "POST",
      body: { title: "", description: "", questions: [newQuestion()] },
    });
    history.replaceState(null, "", `/quizzes/${quiz.id}/edit`);
  } else quiz = await WR.request(`/api/quizzes/${path.split("/")[2]}`);
  let recovered = false;
  try {
    const backup = JSON.parse(localStorage.getItem(backupKey()));
    if (
      backup &&
      confirm(
        "Unsaved changes from your previous visit are available. Restore them?",
      )
    ) {
      quiz = { ...backup, revision: quiz.revision };
      recovered = true;
    }
  } catch {}
  shell(
    `<header class="editor-toolbar"><a href="/dashboard" class="back-link">← My quizzes</a><div class="editor-toolbar-right"><span id="save-status" role="status">All changes saved</span><button id="save-draft" class="secondary-button small">Save draft</button><button id="publish" class="primary-button compact">Publish <span>↗</span></button></div></header><div class="editor-quiz-info"><div class="eyebrow">A LITTLE PREP. A BIG IMPACT. <span id="quiz-status-label" class="status-inline">${quiz.status}</span></div><label class="sr-only" for="quiz-title">Quiz title</label><input id="quiz-title" class="quiz-title-input" maxlength="180" placeholder="Give your quiz a name" value="${h(quiz.title)}"><label class="sr-only" for="quiz-description">Quiz description</label><input id="quiz-description" class="quiz-description-input" maxlength="1500" placeholder="Add a description (optional)" value="${h(quiz.description)}"></div><p id="page-message" class="form-message" role="alert"></p><div class="editor-workspace"><aside class="question-sidebar"><div class="question-sidebar-heading"><strong>Questions <span id="question-count" class="count-badge"></span></strong></div><div id="question-list"></div><div class="add-question-actions"><button class="secondary-button" id="add-multiple">＋ Multiple choice</button><button class="secondary-button" id="add-boolean">＋ True / False</button></div></aside><section id="question-editor" class="question-editor"></section></div>`,
  );
  document.getElementById("quiz-title").oninput = (e) => {
    quiz.title = e.target.value;
    markDirty();
  };
  document.getElementById("quiz-description").oninput = (e) => {
    quiz.description = e.target.value;
    markDirty();
  };
  document.getElementById("save-draft").onclick = () =>
    saveQuiz("draft").catch(() => {});
  document.getElementById("publish").onclick = () =>
    saveQuiz("published").catch(() => {});
  const add = (type) => {
    quiz.questions.push(newQuestion(type));
    selected = quiz.questions.length - 1;
    markDirty();
    renderQuestionList();
    renderQuestion();
  };
  document.getElementById("add-multiple").onclick = () =>
    add("multiple-choice");
  document.getElementById("add-boolean").onclick = () => add("true-false");
  renderQuestionList();
  renderQuestion();
  if (recovered) markDirty();
  window.addEventListener("beforeunload", (event) => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  window.addEventListener("online", async () => {
    if (dirty) {
      try {
        await WR.initialize();
        await saveQuiz("draft");
      } catch {}
    }
  });
}
WR.initialize()
  .then(async () => {
    if (["/login", "/signup"].includes(path)) {
      if (WR.session.user) location.href = "/dashboard";
      else authPage();
      return;
    }
    if (!WR.session.user) {
      location.href = "/login";
      return;
    }
    if (path.startsWith("/quizzes/")) await editor();
    else if (path === "/account")
      shell(
        `<header class="studio-heading"><div><div class="eyebrow">YOUR PERSONAL SPACE</div><h1>My account</h1><p>Your quizzes belong to you.</p></div></header><section class="account-card"><span class="avatar large">${h(WR.session.user.name[0])}</span><h2>${h(WR.session.user.name)}</h2><p>${h(WR.session.user.email)}</p><hr><p>Students join your games with a nickname. They never need an account.</p><p>Game participation and answers expire after 24 hours and are removed by hourly cleanup. Your quizzes stay until you delete them.</p><a href="/dashboard" class="secondary-button">Back to my quizzes →</a></section>`,
        "account",
      );
    else await dashboard();
  })
  .catch((error) => {
    root.innerHTML = `<main class="boot-message"><h1>Let’s try that again.</h1><p>${h(error.message)}</p><a href="${h(location.pathname)}" class="secondary-button">Reload page</a> <a href="/dashboard">My quizzes</a></main>`;
  });
