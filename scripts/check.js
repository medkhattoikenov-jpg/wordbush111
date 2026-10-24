"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const { spawnSync } = require("node:child_process");
const files = [
  "server.js",
  ...["lib", "public", "scripts", "tests"].flatMap((folder) =>
    fs
      .readdirSync(folder)
      .filter((n) => n.endsWith(".js"))
      .map((n) => path.join(folder, n)),
  ),
];
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
  });
  if (result.status) process.exit(result.status);
}
console.log(`Syntax checked ${files.length} JavaScript files.`);
