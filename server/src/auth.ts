import bcrypt from "bcrypt";
import cookieSession from "cookie-session";
import { rateLimit } from "express-rate-limit";
import type { Request, RequestHandler } from "express";
import { createHmac } from "node:crypto";
import { z } from "zod";
import { endpoint } from "./api/request.js";
import type { Env } from "./env.js";

const duration = 12 * 60 * 60 * 1000;
export function auth(env: Env) {
  const key = createHmac("sha256", env.SESSION_SECRET)
    .update(env.DASHBOARD_PASSWORD_HASH)
    .digest("base64url");
  const session = cookieSession({
    name: "dashboard",
    keys: [key],
    httpOnly: true,
    secure: env.SOURCE_MODE === "live",
    sameSite: "lax",
    maxAge: duration,
  });
  const signedIn = (req: Request) =>
    typeof req.session?.expiresAt === "number" &&
    req.session.expiresAt > Date.now();
  const requireSession: RequestHandler = (req, res, next) => {
    if (!signedIn(req)) {
      res.status(401).json({ error: "Sign in to continue" });
      return;
    }
    next();
  };
  const loginLimit = rateLimit({
    windowMs: 60_000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many attempts. Try again in a minute." },
  });
  const login = endpoint(
    {
      body: z.strictObject({
        password: z
          .string()
          .min(1)
          .refine(
            (value) => Buffer.byteLength(value) <= 72,
            "Use up to 72 UTF-8 bytes",
          ),
      }),
    },
    ({ body: { password } }, req, res, next) => {
      void bcrypt
        .compare(password, env.DASHBOARD_PASSWORD_HASH)
        .then((valid) => {
          if (!valid) {
            res.status(401).json({ error: "Incorrect password" });
            return;
          }
          req.session = { expiresAt: Date.now() + duration };
          res.sendStatus(204);
        })
        .catch(next);
    },
  );
  const logout = endpoint({}, (_input, req, res) => {
    req.session = null;
    res.sendStatus(204);
  });
  return { session, requireSession, signedIn, loginLimit, login, logout };
}
