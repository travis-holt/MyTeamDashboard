import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { Config } from "../config.js";
import { checkSheetLink, sourceKeys } from "../fetch/checkLink.js";
import { endpoint } from "./request.js";
import { parseLink } from "../fetch/urls.js";

const body = z.strictObject({
  link: z
    .string()
    .trim()
    .max(2048)
    .refine((value) => {
      try {
        parseLink(value);
        return true;
      } catch {
        return false;
      }
    }, "Expected a Google Sheets view link with a numeric GID"),
  gid: z
    .string()
    .trim()
    .regex(/^\d{1,20}$/, "Expected a numeric tab GID")
    .optional(),
  source: z.enum(sourceKeys).optional(),
});

export function checkLinkRoutes(config: Config) {
  const router = Router();
  const limit = rateLimit({
    windowMs: 60_000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many link checks. Try again in a minute." },
  });
  router.post(
    "/",
    limit,
    endpoint({ body }, ({ body: input }, _req, res, next) => {
      void checkSheetLink(input, config)
        .then((report) => res.json(report))
        .catch(next);
    }),
  );
  return router;
}
