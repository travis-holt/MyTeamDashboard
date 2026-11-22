import bcrypt from "bcrypt";
import { existsSync } from "node:fs";
import { loadConfig } from "./config.js";
import { readBackup, writeBackup } from "./backup/files.js";
import { restoreBackup } from "./backup/data.js";
import { readDataDir, readEnv } from "./env.js";
import { openDb, openExistingDbReadOnly } from "./db/db.js";
import { checkSheetLink, sourceKeys } from "./fetch/checkLink.js";
import { createSync } from "./sync/service.js";
import { createInterface } from "node:readline/promises";

async function hashPassword() {
  const input = createInterface({ input: process.stdin, terminal: false });
  process.stderr.write("Enter dashboard password (input may be visible): ");
  for await (const password of input) {
    input.close();
    if (!password || Buffer.byteLength(password) > 72)
      throw new Error("Enter a password between 1 and 72 UTF-8 bytes");
    console.log(await bcrypt.hash(password, 12));
    return;
  }
  throw new Error("Password input is required");
}
try {
  if (process.argv[2] === "hash-password") await hashPassword();
  else if (process.argv[2] === "test-link") {
    const link = process.argv[3];
    if (!link) throw new Error("Pass a Google Sheets view link");
    const config = loadConfig(
      existsSync("config/sources.local.json")
        ? "config/sources.local.json"
        : undefined,
    );
    const selected = process.argv
      .find((arg) => arg.startsWith("--source="))
      ?.slice("--source=".length);
    const source = sourceKeys.find((key) => key === selected);
    if (selected !== undefined && !source)
      throw new Error(
        "Pass --source=master, --source=schedule or --source=attendance",
      );
    const report = await checkSheetLink({ link, source }, config);
    console.log(JSON.stringify(report, null, 2));
    if (report.error || report.mismatches.length) process.exitCode = 1;
  } else if (process.argv[2] === "backup" || process.argv[2] === "restore") {
    const command = process.argv[2];
    const path = process.argv[3];
    if (command === "restore" && !path)
      throw new Error("Pass a JSON backup file");
    const backup = command === "restore" ? readBackup(path) : null;
    const directory = readDataDir();
    const db = openDb(directory);
    try {
      if (backup) {
        restoreBackup(db, backup);
        console.log("Backup restored");
      } else console.log(writeBackup(db, directory));
    } finally {
      db.close();
    }
  } else if (process.argv[2] === "sync") {
    const job = process.argv[3]?.replace(/^--job=/, "");
    const dryRun = process.argv.includes("--dry-run");
    if (
      dryRun
        ? job !== "attendance"
        : job !== "roster" && job !== "daily" && job !== "all"
    )
      throw new Error(
        "Pass --job=roster, --job=daily, --job=all, or --job=attendance --dry-run",
      );
    const env = readEnv();
    const config = loadConfig(undefined, env.SOURCE_MODE);
    const db = dryRun
      ? openExistingDbReadOnly(env.DATA_DIR)
      : openDb(env.DATA_DIR);
    try {
      const sync = createSync(db, config, env.SOURCE_MODE);
      if (dryRun)
        console.log(JSON.stringify(await sync.previewAttendance(), null, 2));
      else if (job === "roster" || job === "daily" || job === "all") {
        if (!(await sync.start(job))) process.exitCode = 1;
      }
    } finally {
      db.close();
    }
  } else throw new Error("Unknown command");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
