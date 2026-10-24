"use strict";
const socket = io();
const screen = document.getElementById("screen");
const STORAGE = "wordrush:player";
const shapes = ["◆", "▲", "●", "■"];
let state = null,
  pendingAnswer = null,
  clockOffset = 0;
const html = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const number = (n) => Number(n || 0).toLocaleString("en-US");
const save = (x) => localStorage.setItem(STORAGE, JSON.stringify(x));
const saved = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE));
  } catch {
    return null;
  }
};
const linkPin = new URLSearchParams(location.search).get("pin");
if (/^\d{6}$/.test(linkPin || "") && saved()?.pin !== linkPin)
  localStorage.removeItem(STORAGE);
function setError(m) {
  const p = document.getElementById("form-error");
  if (p) p.textContent = m || "";
}
function joinForm() {
  state = null;
  pendingAnswer = null;
  screen.innerHTML = `<section class="entry-layout"><div class="entry-copy"><div class="eyebrow">✦ THE CLASSROOM IS YOUR ARENA</div><h1>Words.<br><span class="gradient-text">Ready.</span><br>Go!</h1><p>Grab your phone, enter the game PIN, and show what you know.</p><div class="pill-line"><span>⚡ Quick rounds</span><span>🏆 Real rankings</span></div></div><form id="join-form" class="panel join-panel"><div class="join-icon">⚡</div><div class="panel-overline">LET'S GET YOU IN</div><h2>Join your game</h2><label for="pin">6-DIGIT GAME PIN</label><input id="pin" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="000 000" required><label for="nickname">YOUR NAME</label><input id="nickname" type="text" maxlength="24" placeholder="Your first name" minlength="2" autocomplete="nickname" required><p id="form-error" class="error-message" role="alert"></p><button class="primary-button" id="join-button" type="submit">ENTER THE ARENA <span>→</span></button><div class="card-footnote">No account needed. Just your game PIN.</div></form></section>`;
  const params = new URLSearchParams(location.search);
  const prefilled = params.get("pin");
  if (prefilled && /^\d{6}$/.test(prefilled))
    document.getElementById("pin").value = prefilled;
  document.getElementById("join-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const pin = document.getElementById("pin").value.trim(),
      name = document.getElementById("nickname").value.trim();
    if (!socket.connected) {
      setError("Connecting to game server… please try again.");
      return;
    }
    const btn = document.getElementById("join-button");
    btn.disabled = true;
    setError("");
    socket.timeout(8000).emit("player:join", { pin, name }, (err, result) => {
      btn.disabled = false;
      if (err) return setError("Network error. Please retry.");
      if (!result?.ok) return setError(result?.message || "Could not join.");
      save({ pin: result.pin, playerToken: result.playerToken });
    });
  });
}
function podium(items, withAll) {
  if (withAll)
    return `<div class="ranking-list">${items.map((p) => `<div class="rank-row ${state.me?.name === p.name ? "me" : ""}"><span class="rank-position">#${p.rank}</span><span class="rank-name">${html(p.name)}</span><span class="rank-score">${number(p.score)} pts</span></div>`).join("")}</div>`;
  const places = [items[1], items[0], items[2]];
  return `<div class="podium-grid">${places.map((p, i) => `<div class="podium-person ${["second", "first", "third"][i]}">${p ? `<div class="podium-avatar">${["🥈", "👑", "🥉"][i]}</div><span class="podium-name">${html(p.name)}</span><span class="podium-score">${number(p.score)} points</span>` : `<div class="podium-avatar">?</div><span class="podium-name">—</span>`}<div class="podium-block">${[2, 1, 3][i]}</div></div>`).join("")}</div>`;
}
function render() {
  if (!state) return;
  let out = "";
  if (state.status === "lobby") {
    out = `<div class="game-screen"><div class="panel center-panel"><div class="waiting-icon">🎮</div><div class="tiny-cap" style="margin-top:20px">YOU'RE IN! · ${html(state.title)}</div><h1>You're in the lobby!</h1><p>Waiting for your teacher to start the game.</p><div class="waiting-dots" aria-label="Waiting"><i></i><i></i><i></i></div><p class="quiet-note">Game PIN <strong>${html(state.pin)}</strong> · ${state.players.length} player${state.players.length === 1 ? "" : "s"} joined</p><div class="player-pill">✓ Playing as ${html(state.me?.name || "Student")}</div><div style="margin-top:28px"><button class="secondary-button" id="change-game">Wrong game? Change PIN</button></div></div></div>`;
  } else if (state.status === "question" || state.status === "reveal") {
    const q = state.question,
      answered = state.me?.lastAnswer,
      done = state.status === "reveal";
    out = `<div class="question-shell"><div class="question-header"><span>QUESTION <strong>${q.number}</strong> / ${q.total}</span><span class="score-chip">★ ${number(state.me?.score)} PTS</span></div><div class="timer-row"><span>${done ? "TIME’S UP" : "TIME REMAINING"}</span><span class="timer-seconds" id="timer-seconds">${done ? "0" : "--"}s</span></div><div class="timer-bar"><div class="timer-fill" id="timer-fill" style="width:${done ? 0 : 100}%"></div></div><h1 class="question-headline">${html(q.prompt)}</h1><div class="answers-grid">${q.options.map((x, i) => `<button type="button" class="answer ${answered?.selected === i ? "is-selected" : ""} ${done ? (state.reveal.correct === i ? "is-correct" : "is-wrong") : ""}" ${done || answered || pendingAnswer !== null ? "disabled" : ""} data-answer="${i}"><span class="answer-shape">${shapes[i]}</span><span>${html(x)}</span></button>`).join("")}</div>${done ? `<div class="feedback-box ${answered?.correct ? "correct" : "incorrect"}"><strong>${answered ? (answered.correct ? "✓ Nice work!" : "✕ Not this time") : "⌛ Time’s up!"}</strong><p>${answered?.correct ? `+${number(answered.points)} points earned` : `Correct answer: ${html(q.options[state.reveal.correct])}`}</p></div><p class="quiet-note">Waiting for the teacher to continue…</p>` : answered ? `<div class="feedback-box"><strong>Answer locked in 🔒</strong><p>Waiting for the other players…</p></div>` : `<p class="quiet-note">Tap your answer before time runs out!</p>`}</div>`;
  } else if (state.status === "podium") {
    out = `<div class="ranking-wrap"><div class="tiny-cap">🏆 THE BIG REVEAL 🏆</div><h1>The Podium</h1><p class="subtitle">A round of applause for our top players!</p>${podium(state.ranking || [], false)}<p class="quiet-note">Full results are coming next…</p></div>`;
  } else if (state.status === "leaderboard" || state.status === "finished") {
    out = `<div class="ranking-wrap"><div class="tiny-cap">✦ THE FINAL SCOREBOARD ✦</div><h1>All Players</h1><p class="subtitle">Every word learned is a win. Nice work, everyone!</p>${podium(state.ranking || [], true)}<p class="quiet-note">Ready for next time? Your teacher will share a new game PIN.</p><button class="secondary-button" id="change-game" style="margin-top:22px">JOIN ANOTHER GAME →</button></div>`;
  }
  if (["podium", "leaderboard", "finished"].includes(state.status) && state.me)
    out = out.replace(
      '<p class="subtitle">',
      `<div class="final-personal">Your place: #${state.me.rank} · ${number(state.me.score)} points</div><p class="subtitle">`,
    );
  screen.innerHTML = out;
  document.getElementById("change-game")?.addEventListener("click", () => {
    socket.timeout(5000).emit("player:leave", {}, () => {
      localStorage.removeItem(STORAGE);
      history.replaceState(null, "", "/");
      joinForm();
    });
  });
  screen.querySelectorAll("[data-answer]").forEach((btn) =>
    btn.addEventListener("click", () => {
      if (
        !state ||
        state.status !== "question" ||
        state.me?.lastAnswer ||
        pendingAnswer !== null
      )
        return;
      const selected = Number(btn.dataset.answer),
        questionId = state.question.id,
        phaseId = state.phaseId;
      pendingAnswer = selected;
      render();
      socket
        .timeout(10000)
        .emit("player:answer", { selected, questionId, phaseId }, (err, r) => {
          pendingAnswer = null;
          if (err || !r?.ok) {
            alert(r?.message || "Could not submit your answer. Please retry.");
            render();
          }
        });
    }),
  );
  updateClock();
}
function updateClock() {
  if (!state || state.status !== "question") return;
  const remaining = Math.max(
    0,
    state.question.endsAt - (Date.now() + clockOffset),
  );
  const seconds = Math.ceil(remaining / 1000),
    percent = (100 * remaining) / (state.question.duration * 1000);
  const label = document.getElementById("timer-seconds"),
    fill = document.getElementById("timer-fill");
  if (label) label.textContent = seconds + "s";
  if (fill) fill.style.width = percent + "%";
}
setInterval(updateClock, 120);
socket.on("game:state", (s) => {
  state = s;
  clockOffset = s.serverTime - Date.now();
  pendingAnswer = null;
  render();
});
socket.on("connect", () => {
  const session = saved();
  if (session?.pin && session?.playerToken) {
    socket.timeout(7000).emit("player:resume", session, (err, r) => {
      if (err) {
        setTimeout(() => {
          if (!state) joinForm();
        }, 4000);
        return;
      }
      if (!r?.ok) {
        localStorage.removeItem(STORAGE);
        joinForm();
      }
    });
  } else if (!state) joinForm();
});
socket.on("disconnect", () => {
  const el = document.getElementById("offline-banner");
  if (!el) {
    const div = document.createElement("div");
    div.className = "connection-banner";
    div.id = "offline-banner";
    div.textContent = "Connection lost. Reconnecting…";
    document.body.prepend(div);
  }
});
socket.on("connect", () => document.getElementById("offline-banner")?.remove());
if (!saved()) joinForm();
socket.on("game:expired", () => {
  localStorage.removeItem(STORAGE);
  joinForm();
  setError("This game expired. Ask your teacher for a new PIN.");
});
socket.on("connect_error", () => setError("Unable to connect. Retrying…"));
