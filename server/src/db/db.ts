import Database from "better-sqlite3";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

export type Db = Database.Database;
function migrateD5(db: Db) {
  // Keep the oldest date and the newest nonempty comment when folding daily D5 rows.
  db.exec(`
    CREATE TEMP TABLE d5_migration AS
    SELECT code || '|D5' AS id, code,
      MIN(date) OVER (PARTITION BY code) AS date, rule_id, severity, missing, source, state,
      FIRST_VALUE(tl_comment) OVER (
        PARTITION BY code ORDER BY (TRIM(tl_comment) <> '') DESC, updated_at DESC, date DESC, id DESC
      ) AS tl_comment,
      auto_cleared, MIN(created_at) OVER (PARTITION BY code) AS created_at, updated_at,
      ROW_NUMBER() OVER (PARTITION BY code ORDER BY date DESC, updated_at DESC, id DESC) AS position
    FROM discrepancies WHERE rule_id='D5';
    DELETE FROM discrepancies WHERE rule_id='D5';
    INSERT INTO discrepancies (
      id, code, date, rule_id, severity, missing, source, state, tl_comment, auto_cleared, created_at, updated_at
    ) SELECT id, code, date, rule_id, severity, missing, source, state, tl_comment, auto_cleared, created_at, updated_at
    FROM d5_migration WHERE position=1;
    DROP TABLE d5_migration;
  `);
}
export function openExistingDbReadOnly(directory: string): Db {
  if (directory === ":memory:")
    throw new Error(
      "Use the DATA_DIR of an existing dashboard for the dry run",
    );
  return new Database(resolve(directory, "dashboard.db"), {
    readonly: true,
    fileMustExist: true,
  });
}

export function openDb(directory: string): Db {
  if (directory !== ":memory:")
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new Database(
    directory === ":memory:" ? directory : resolve(directory, "dashboard.db"),
  );
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    const version = db.pragma("user_version", { simple: true });
    if (version === 0)
      db.transaction(() => {
        db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
        db.pragma("user_version = 2");
      })();
    else if (version === 1)
      db.transaction(() => {
        migrateD5(db);
        db.pragma("user_version = 2");
      })();
    else if (version !== 2)
      throw new Error("Unsupported database schema version");
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
