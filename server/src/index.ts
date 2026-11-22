import express, { type ErrorRequestHandler } from "express";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ZodError } from "zod";
import { loadConfig } from "./config.js";
import { readEnv } from "./env.js";
import { openDb } from "./db/db.js";
import { auth } from "./auth.js";
import { checkLinkRoutes } from "./api/checkLink.js";
import { createRoutes } from "./api/routes.js";
import { createSync } from "./sync/service.js";
import { backupRoutes } from "./backup/routes.js";
import { startBackupCron, startCron } from "./sync/cron.js";

export function startServer(now?: () => Date) {
  const env = readEnv();
  const config = loadConfig(undefined, env.SOURCE_MODE);
  const db = openDb(env.DATA_DIR);
  const sync = createSync(db, config, env.SOURCE_MODE, now);
  const login = auth(env);
  const app = express();
  app.disable("x-powered-by");
  if (env.SOURCE_MODE === "live") app.set("trust proxy", 1);
  app.use((_req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("X-Frame-Options", "DENY");
    res.set("Referrer-Policy", "no-referrer");
    next();
  });
  app.get("/api/health", (_req, res) => {
    db.prepare("SELECT 1").get();
    res.json({ ok: true });
  });
  app.use(
    "/api",
    (req, res, next) => {
      res.set("Cache-Control", "no-store");
      if (
        req.method !== "GET" &&
        req.method !== "HEAD" &&
        req.get("Sec-Fetch-Site") === "cross-site"
      ) {
        res.status(403).json({ error: "Cross-site request rejected" });
        return;
      }
      next();
    },
    express.json({ limit: "128kb" }),
    login.session,
  );
  app.post("/api/login", login.loginLimit, login.login);
  app.use("/api", login.requireSession);
  app.post("/api/logout", login.logout);
  app.use("/api/backup", backupRoutes(db));
  app.use("/api/check-link", checkLinkRoutes(config));
  app.use("/api", createRoutes(db, config, sync));
  app.use(express.static(resolve("web/dist"), { index: false }));
  app.get("*", (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!["/", "/login"].includes(req.path)) {
      return login.session(req, res, () => {
        if (!login.signedIn(req)) {
          res.redirect("/login");
          return;
        }
        res.sendFile(resolve("web/dist/index.html"));
      });
    }
    res.sendFile(resolve("web/dist/index.html"));
  });
  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error instanceof ZodError) {
      res.status(400).json({
        error: error.issues
          .map((issue) => issue.path.join(".") + " " + issue.message)
          .join("; "),
      });
      return;
    }
    if (error?.status >= 400 && error.status < 500) {
      res.status(error.status).json({ error: "Invalid request" });
      return;
    }
    console.error(
      "Request failed:",
      error instanceof Error ? error.name : "Unknown error",
    );
    res.status(500).json({ error: "Something went wrong" });
  };
  app.use(errors);
  const cron = startCron(config, sync);
  if (env.DATA_DIR !== ":memory:") cron.push(startBackupCron(db, env.DATA_DIR));
  const server = app.listen(
    env.PORT,
    env.SOURCE_MODE === "fixture" ? "127.0.0.1" : "0.0.0.0",
    () => console.log("Team Dashboard listening on port " + env.PORT),
  );
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.once(signal, () => {
      for (const task of cron) void task.destroy();
      server.close(() => {
        if (!sync.active) db.close();
        process.exit(0);
      });
    });
  return { app, server, sync };
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
  try {
    startServer();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
