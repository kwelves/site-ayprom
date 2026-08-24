import { unlink } from "node:fs/promises";
import path from "node:path";
import { test as teardown } from "@playwright/test";
import { cleanupLocalLoginAttempt } from "../support/local-auth";

const authFile = path.join(process.cwd(), ".playwright-state", "auth", "admin.json");

teardown("@smoke cleanup owned local admin auth fixtures", async () => {
  await cleanupLocalLoginAttempt();
  await unlink(authFile).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
});
