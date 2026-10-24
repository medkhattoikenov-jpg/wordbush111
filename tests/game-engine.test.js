"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const {
  normalizeQuiz,
  playableErrors,
  requirePlayable,
} = require("../lib/quizzes");
const question = (type = "multiple-choice") => ({
  id: randomUUID(),
  type,
  prompt: "Translate hello",
  options:
    type === "true-false"
      ? ["True", "False"]
      : ["Hello", "Goodbye", "Thanks", "Please"],
  correct: 0,
  duration: 20,
});
test("drafts can be incomplete, publishing and hosting require complete questions", () => {
  const q = normalizeQuiz({
    title: "",
    questions: [
      { ...question(), prompt: "", options: ["", "", "", ""], correct: null },
    ],
  });
  assert.equal(playableErrors(q).length, 5);
  assert.throws(() => requirePlayable(q), /Complete your quiz/);
});
test("both supported types validate with their own option counts and timers", () => {
  const quiz = normalizeQuiz({
    title: "My quiz",
    questions: [question(), question("true-false")],
  });
  requirePlayable(quiz);
  assert.equal(quiz.questions[1].options.length, 2);
  for (const patch of [
    { duration: 4 },
    { duration: 121 },
    { correct: 4 },
    { options: ["only one"] },
    { type: "essay" },
  ])
    assert.throws(() =>
      normalizeQuiz({
        title: "Invalid",
        questions: [{ ...question(), ...patch }],
      }),
    );
});
test("large quizzes, ordering, distinct question identities and duplicate-answer validation", () => {
  const q = question();
  const quiz = normalizeQuiz({
    title: "Long quiz",
    questions: Array.from({ length: 250 }, (_, i) => ({
      ...q,
      prompt: `Question ${i + 1}`,
    })),
  });
  assert.equal(quiz.questions.length, 250);
  assert.equal(new Set(quiz.questions.map((q) => q.id)).size, 250);
  assert.equal(quiz.questions[249].prompt, "Question 250");
  assert.ok(
    playableErrors(
      normalizeQuiz({
        title: "Duplicates",
        questions: [{ ...q, options: ["same", "SAME", "c", "d"] }],
      }),
    ).some((e) => e.includes("distinct")),
  );
});
test("empty sample metadata and unsafe shapes cannot become playable quizzes", () => {
  for (const value of [
    null,
    [],
    { questions: null },
    { title: "x", questions: [null] },
  ])
    assert.throws(() => normalizeQuiz(value));
  const sample = require("../quizzes/holidays-2a.json");
  requirePlayable(
    normalizeQuiz({
      title: sample.title,
      questions: sample.questions.map((q) => ({
        ...q,
        type: "multiple-choice",
        duration: sample.duration,
      })),
    }),
  );
  assert.equal(sample.questions.length, 20);
});
