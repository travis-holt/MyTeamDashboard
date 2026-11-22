import cron from "node-cron";
import type { Db } from "../db/db.js";
import { backupTimezone, writeBackup } from "../backup/files.js";
import type { Config } from "../config.js";
import type { SyncService } from "./service.js";
export function startCron(config: Config, sync: SyncService) {
  const options = { timezone: config.timezone };
  return [
    cron.schedule(
      config.jobs.weekly,
      () => {
        void sync.start("roster");
      },
      options,
    ),
    cron.schedule(
      config.jobs.daily,
      () => {
        void sync.start("daily");
      },
      options,
    ),
  ];
}

export function startBackupCron(db: Db, directory: string) {
  return cron.schedule(
    "0 2 * * *",
    () => {
      try {
        writeBackup(db, directory);
      } catch {
        console.error(
          "Nightly backup failed. Check DATA_DIR and available disk space.",
        );
      }
    },
    { timezone: backupTimezone },
  );
}
