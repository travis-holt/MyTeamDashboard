import express, { Router, type ErrorRequestHandler } from "express";
import { z } from "zod";
import { endpoint } from "../api/request.js";
import type { Db } from "../db/db.js";
import {
  BackupError,
  exportBackup,
  maxBackupBytes,
  parseBackup,
  previewBackup,
  restoreBackup,
} from "./data.js";
import { backupName } from "./files.js";

export function backupRoutes(db: Db) {
  const router = Router();
  const file = express.raw({
    type: "application/octet-stream",
    limit: maxBackupBytes,
    inflate: false,
  });
  const upload = z.instanceof(Buffer, { error: "Upload a JSON backup file" });
  const restoreQuery = z.strictObject({
    token: z.string().regex(/^[0-9a-f]{64}$/),
  });
  router.get(
    "/",
    endpoint({}, (_input, _req, res) => {
      const now = new Date();
      const content = exportBackup(db, now);
      res.attachment(backupName(now)).send(content);
    }),
  );
  router.post(
    "/preview",
    file,
    endpoint({ body: upload }, ({ body }, _req, res) =>
      res.json(previewBackup(db, parseBackup(body))),
    ),
  );
  router.post(
    "/restore",
    file,
    endpoint(
      { body: upload, query: restoreQuery },
      ({ body, query }, _req, res) => {
        restoreBackup(db, parseBackup(body), query.token);
        res.sendStatus(204);
      },
    ),
  );
  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof BackupError)
      res.status(error.status).json({ error: error.message });
    else next(error);
  };
  router.use(errors);
  return router;
}
