import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";

const emptyObject = z.strictObject({});
type Part = "params" | "query" | "body";
type Schemas = Partial<Record<Part, z.ZodType>>;
type Input<S extends Schemas> = {
  [K in keyof S]: S[K] extends z.ZodType ? z.output<S[K]> : never;
};

export function endpoint<S extends Schemas>(
  schemas: S,
  handler: (
    input: Input<S>,
    req: Request,
    res: Response,
    next: NextFunction,
  ) => unknown,
): RequestHandler {
  const schema = z.object({
    params: schemas.params ?? emptyObject,
    query: schemas.query ?? emptyObject,
    body: schemas.body ?? emptyObject.optional(),
  });
  return (req, res, next) => {
    if (
      (Number(req.get("Content-Length")) > 0 || req.get("Transfer-Encoding")) &&
      !req.is("application/json") &&
      !(Buffer.isBuffer(req.body) && req.is("application/octet-stream"))
    ) {
      res.status(400).json({ error: "body: Unsupported request format" });
      return;
    }
    const input = schema.parse({
      params: req.params,
      query: req.query,
      body: req.body,
    });
    handler(input as Input<S>, req, res, next);
  };
}

export const day = z.iso
  .date()
  .refine((value) => value >= "1000-01-01", "Invalid date");
export const scopes = z.enum(["mine", "covered", "all"]);
export const scopeQuery = z.strictObject({ scope: scopes.optional() });
export const code = z
  .string()
  .min(1)
  .regex(/^[^\u0000-\u001F\u007F]+$/, "Invalid agent code");
export const discrepancyId = z
  .string()
  .regex(/^.+\|(?:\d{4}-\d{2}-\d{2}\|D[1-7]|D5)$/, "Invalid discrepancy ID");
export const noteId = z
  .string()
  .regex(/^[1-9]\d*$/, "Invalid note ID")
  .transform(Number)
  .pipe(z.number().int().positive());
