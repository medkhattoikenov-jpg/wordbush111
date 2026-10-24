"use strict";
const { randomUUID } = require("node:crypto");
class Problem extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function string(value, max, label) {
  if (typeof value !== "string" || value.length > max)
    throw new Problem(422, `${label} must be text, up to ${max} characters.`);
  return value.trim();
}
function normalizeQuiz(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Problem(422, "Send a quiz object.");
  const title = string(input.title ?? "", 180, "Quiz title");
  const description = string(input.description ?? "", 1500, "Description");
  if (!Array.isArray(input.questions))
    throw new Problem(422, "Questions must be a list.");
  // A request-size safeguard, not a lesson-length restriction.
  if (input.questions.length > 2000)
    throw new Problem(
      422,
      "This quiz exceeds the 2,000-question storage safeguard.",
    );
  const seen = new Set();
  const questions = input.questions.map((q, index) => {
    if (!q || !["multiple-choice", "true-false"].includes(q.type))
      throw new Problem(422, `Question ${index + 1}: choose a supported type.`);
    const id = uuid(q.id) && !seen.has(q.id) ? q.id : randomUUID();
    seen.add(id);
    const count = q.type === "true-false" ? 2 : 4;
    if (!Array.isArray(q.options) || q.options.length !== count)
      throw new Problem(
        422,
        `Question ${index + 1}: expected ${count} choices.`,
      );
    const options =
      q.type === "true-false"
        ? ["True", "False"]
        : q.options.map((value) => string(value, 300, "Answer"));
    if (
      q.correct !== null &&
      (!Number.isInteger(q.correct) || q.correct < 0 || q.correct >= count)
    )
      throw new Problem(422, `Question ${index + 1}: invalid correct answer.`);
    if (!Number.isInteger(q.duration) || q.duration < 5 || q.duration > 120)
      throw new Problem(
        422,
        `Question ${index + 1}: timer must be 5–120 seconds.`,
      );
    return {
      id,
      type: q.type,
      prompt: string(q.prompt ?? "", 600, "Question"),
      options,
      correct: q.correct,
      duration: q.duration,
    };
  });
  return { title, description, questions };
}
function playableErrors(quiz) {
  const errors = [];
  if (!quiz.title.trim()) errors.push("Give your quiz a title.");
  if (!quiz.questions.length) errors.push("Add at least one question.");
  quiz.questions.forEach((q, i) => {
    if (!q.prompt.trim()) errors.push(`Question ${i + 1}: enter a question.`);
    if (q.options.some((value) => !value.trim()))
      errors.push(`Question ${i + 1}: fill in every answer.`);
    if (
      new Set(q.options.map((value) => value.trim().toLocaleLowerCase()))
        .size !== q.options.length
    )
      errors.push(`Question ${i + 1}: answers must be distinct.`);
    if (!Number.isInteger(q.correct))
      errors.push(`Question ${i + 1}: select the correct answer.`);
  });
  return errors;
}
function requirePlayable(quiz) {
  const errors = playableErrors(quiz);
  if (errors.length)
    throw new Problem(
      422,
      "Complete your quiz before publishing or hosting.",
      errors,
    );
}
function fromRow(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    questions: row.questions,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
  };
}
async function ownedQuiz(db, id, owner) {
  if (!uuid(id)) throw new Problem(404, "Quiz not found.");
  const result = await db.query(
    "SELECT * FROM quizzes WHERE id=$1 AND owner_id=$2",
    [id, owner],
  );
  if (!result.rows[0]) throw new Problem(404, "Quiz not found.");
  return fromRow(result.rows[0]);
}
module.exports = {
  Problem,
  uuid,
  normalizeQuiz,
  playableErrors,
  requirePlayable,
  fromRow,
  ownedQuiz,
};
