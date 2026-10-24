"use strict";
require("dotenv").config({ quiet: true });
require("../lib/db")
  .openDatabase()
  .then(async (db) => {
    console.log(`Database migrations applied (${db.kind}).`);
    await db.close();
  })
  .catch((error) => {
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
  });
