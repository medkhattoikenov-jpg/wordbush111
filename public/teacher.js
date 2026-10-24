"use strict";
const screen = document.getElementById("teacher-screen"),
  h = WR.html,
  n = WR.number;
const pin = new URLSearchParams(location.search).get("pin");
let socket,
  state = null,
  clockOffset = 0;
function notify(text) {
  document.getElementById("host-message").textContent = text || "";
}
function ranking(items) {
  return `<div class="ranking-list">${items.map((p) => `<div class="rank-row"><span class="rank-position">#${p.rank}</span><span class="rank-name">${h(p.name)}</span><span class="rank-score">${n(p.score)} pts</span></div>`).join("")}</div>`;
}
function podium(items) {
  return `<div class="podium-grid">${[items[1], items[0], items[2]].map((p, i) => `<div class="podium-person ${["second", "first", "third"][i]}"><div class="podium-avatar">${["🥈", "👑", "🥉"][i]}</div><span class="podium-name">${h(p?.name || "—")}</span><span class="podium-score">${p ? n(p.score) + " points" : ""}</span><div class="podium-block">${[2, 1, 3][i]}</div></div>`).join("")}</div>`;
}
function render() {
  if (!state) return;
  const s = state,
    count = s.players.length,
    connected = s.players.filter((p) => p.connected).length;
  let content = "",
    controls = "";
  if (s.status === "lobby") {
    content = `<div class="teacher-cards"><div class="teacher-card"><div class="tiny-cap">STUDENTS IN LOBBY</div><div class="teacher-stat">${count}</div><p class="teacher-hint">${connected} online · students appear automatically</p></div><div class="teacher-card"><div class="tiny-cap">JOIN ADDRESS</div><h3>${h(location.host)}</h3><p class="teacher-hint">Share the website and six-digit PIN.</p><button class="secondary-button" id="copy-link">COPY STUDENT LINK ↗</button></div></div><div class="teacher-card"><h3>Who's here?</h3><div class="teacher-avatar-tags">${count ? s.players.map((p) => `<span class="student-tag ${p.connected ? "" : "offline"}">${h(p.name)} ${p.connected ? "✓" : "· offline"}</span>`).join("") : '<p class="teacher-hint">Waiting for your first student…</p>'}</div></div>`;
    controls = `<button class="primary-button" data-action="start" ${connected ? "" : "disabled"}>START GAME <span>→</span></button>`;
  } else if (s.status === "question" || s.status === "reveal") {
    const q = s.question,
      done = s.status === "reveal";
    content = `<div class="teacher-cards"><div class="teacher-card"><div class="tiny-cap">QUESTION ${q.number} / ${q.total} · ${q.type === "true-false" ? "TRUE / FALSE" : "MULTIPLE CHOICE"}</div><div class="teacher-stat" id="timer-seconds">${done ? "0" : "--"}s</div><div class="timer-bar"><div class="timer-fill" id="timer-fill" style="width:${done ? 0 : 100}%"></div></div></div><div class="teacher-card"><div class="tiny-cap">ANSWERS RECEIVED</div><div class="teacher-stat">${s.players.filter((p) => p.answered).length}<span style="font-size:22px;color:#a3abc5"> / ${count}</span></div><p class="teacher-hint">${connected} currently connected</p></div></div><div class="teacher-card"><div class="tiny-cap">${done ? "CORRECT ANSWER REVEALED" : "LIVE QUESTION"}</div><h2>${h(q.prompt)}</h2><div class="teacher-answers">${q.options.map((x, i) => `<div class="answer-option-${i} ${done && s.reveal.correct === i ? "correct-choice" : ""}"><span>${["◆", "▲", "●", "■"][i]} ${h(x)}</span><span>${done ? s.reveal.counts[i] + " votes" : ""}</span></div>`).join("")}</div></div>`;
    const label = !done
      ? "REVEAL ANSWER"
      : s.questionIndex + 1 === s.totalQuestions
        ? "SHOW PODIUM"
        : "NEXT QUESTION";
    controls = `<button class="primary-button" data-action="next">${label} <span>→</span></button>`;
  } else if (s.status === "podium") {
    content = `<div class="teacher-card teacher-podium" style="text-align:center"><div class="tiny-cap">OUR TOP THREE</div><h2>The Podium</h2>${podium(s.ranking)}</div>`;
    controls =
      '<button class="primary-button" data-action="next">SHOW FULL RESULTS <span>→</span></button>';
  } else {
    content = `<div class="teacher-card"><div class="tiny-cap">${s.status === "finished" ? "GAME FINISHED" : "COMPLETE CLASS RANKING"}</div><h2>Final Results</h2>${ranking(s.ranking || [])}</div>`;
    controls =
      s.status === "leaderboard"
        ? '<button class="primary-button" data-action="next">FINISH GAME <span>✓</span></button>'
        : '<a class="secondary-button" href="/dashboard">BACK TO MY QUIZZES →</a>';
  }
  screen.innerHTML = `<section class="game-screen"><a class="teacher-title-link" href="/dashboard">← My quizzes</a><div class="teacher-top"><div><div class="eyebrow">${s.status === "lobby" ? "READY WHEN YOU ARE" : ["leaderboard", "finished"].includes(s.status) ? "EVERY WORD LEARNED IS A WIN" : "LIVE CLASSROOM"}</div><h1>${h(s.title)}</h1><p class="teacher-hint">${h(s.subtitle || "")} · ${s.totalQuestions} questions</p></div><div class="teacher-game-pin"><small>GAME PIN</small><strong>${h(s.pin)}</strong></div></div>${content}<div class="teacher-controls">${controls}<div class="teacher-actions-extra">${s.status !== "finished" ? '<button class="end-game-button" id="end-game">End game</button>' : ""}</div></div></section>`;
  document.getElementById("copy-link")?.addEventListener("click", async () => {
    const url = `${location.origin}/join/${pin}`;
    try {
      await navigator.clipboard.writeText(url);
      document.getElementById("copy-link").textContent = "✓ LINK COPIED";
    } catch {
      prompt("Copy this student link:", url);
    }
  });
  screen
    .querySelectorAll("[data-action]")
    .forEach(
      (button) => (button.onclick = () => action(button.dataset.action)),
    );
  document.getElementById("end-game")?.addEventListener("click", () => {
    if (confirm("End this game now? Students will see the current results."))
      action("end");
  });
  updateClock();
}
function action(action) {
  if (!socket?.connected)
    return notify("Connection lost. Wait for the server to reconnect.");
  screen.querySelectorAll("button").forEach((b) => (b.disabled = true));
  const phaseId = state.phaseId;
  socket.timeout(10000).emit(`host:${action}`, { phaseId }, (error, result) => {
    if (error || !result?.ok) {
      notify(result?.message || "Unable to reach the server. Please retry.");
      render();
      if (result?.status === 401)
        notify(
          "Your session expired. Log in in another tab, then refresh this screen.",
        );
    } else notify("");
  });
}
function updateClock() {
  if (state?.status !== "question") return;
  const remaining = Math.max(
    0,
    state.question.endsAt - (Date.now() + clockOffset),
  );
  const label = document.getElementById("timer-seconds"),
    bar = document.getElementById("timer-fill");
  if (label) label.textContent = Math.ceil(remaining / 1000) + "s";
  if (bar)
    bar.style.width =
      Math.min(100, (100 * remaining) / (state.question.duration * 1000)) + "%";
}
setInterval(updateClock, 120);
WR.initialize()
  .then((session) => {
    if (!session.user) {
      location.href = "/login";
      return;
    }
    if (!/^\d{6}$/.test(pin || "")) {
      location.href = "/dashboard";
      return;
    }
    socket = io({ auth: { csrfToken: session.csrfToken } });
    socket.on("game:state", (s) => {
      state = s;
      clockOffset = s.serverTime - Date.now();
      render();
    });
    socket.on("connect", () => {
      notify("Restoring your game…");
      socket
        .timeout(10000)
        .emit("host:resume", { pin }, (error, result) =>
          notify(
            error
              ? "Could not restore the game. Refresh to retry."
              : result?.ok
                ? ""
                : result?.message || "Game unavailable. Return to My quizzes.",
          ),
        );
    });
    socket.on("disconnect", () => notify("Connection lost. Reconnecting…"));
    socket.on("connect_error", () => notify("Unable to connect. Retrying…"));
    socket.on("game:expired", (data) => notify(data.message));
  })
  .catch((error) => notify(error.message));
