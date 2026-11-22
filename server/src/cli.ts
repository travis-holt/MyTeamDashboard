import bcrypt from "bcrypt";
import { existsSync } from "node:fs";
import { loadConfig } from "./config.js";
import { readBackup, writeBackup } from "./backup/files.js";
import { restoreBackup } from "./backup/data.js";
import { readDataDir, readEnv } from "./env.js";
import { openDb } from "./db/db.js";
import { fetchCsv } from "./fetch/fetchCsv.js";
import { parseLink, exportUrl } from "./fetch/urls.js";
import { sampleSourceDate } from "./fetch/sampleDate.js";
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
    const { sheetId, gid } = parseLink(link);
    const config = loadConfig(
      existsSync("config/sources.local.json")
        ? "config/sources.local.json"
        : undefined,
    );
    const keys = ["master", "schedule", "attendance"] as const;
    const selected = process.argv
      .find((arg) => arg.startsWith("--source="))
      ?.slice("--source=".length);
    const source =
      selected === undefined
        ? keys.find(
            (key) =>
              config.sources[key].sheetId === sheetId &&
              config.sources[key].gid === gid,
          )
        : keys.find((key) => key === selected);
    if (selected !== undefined && !source)
      throw new Error(
        "Pass --source=master, --source=schedule or --source=attendance",
      );
    const result = await fetchCsv(exportUrl(sheetId, gid));
    const reveal = process.argv.includes("--show-rows");
    console.log({
      sheetId,
      gid,
      status: result.status,
      contentType: result.contentType,
      bytes: result.bytes,
      rowCount: result.rows.length,
      dateOrder: config.dateOrder,
      sampleDate: sampleSourceDate(result.rows, config, source),
    });
    console.log(
      result.rows
        .slice(0, 5)
        .map((row) =>
          row.map((value) => value && (reveal ? value : "[masked]")),
        ),
    );
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
    if (job !== "roster" && job !== "daily" && job !== "all")
      throw new Error("Pass --job=roster, --job=daily or --job=all");
    const env = readEnv();
    const config = loadConfig(undefined, env.SOURCE_MODE);
    const db = openDb(env.DATA_DIR);
    try {
      if (!(await createSync(db, config, env.SOURCE_MODE).start(job)))
        process.exitCode = 1;
    } finally {
      db.close();
    }
  } else throw new Error("Unknown command");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
