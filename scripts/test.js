"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const { spawnSync } = require("node:child_process");
const files = fs
  .readdirSync(path.join(__dirname, "..", "tests"))
  .filter((name) => name.endsWith(".test.js"))
  .map((name) => path.join(__dirname, "..", "tests", name));
const result = spawnSync(
  process.execPath,
  ["--test", "--test-concurrency=1", ...files],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
