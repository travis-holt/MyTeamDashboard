import { setTimeout as delay } from "node:timers/promises";
import { parse } from "csv-parse/sync";
export class SourceAccessError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly contentType?: string,
  ) {
    super(message);
  }
}
export function decodeCsv(body: string): string[][] {
  return parse(body, {
    bom: true,
    relax_column_count: true,
    skip_empty_lines: false,
  });
}
async function readBody(response: Response, limit?: number) {
  if (!limit) return response.text();
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let total = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) return chunks.join("") + decoder.decode();
    total += part.value.length;
    if (total > limit) {
      await reader.cancel();
      throw new SourceAccessError("CSV exceeds the diagnostic download limit");
    }
    chunks.push(decoder.decode(part.value, { stream: true }));
  }
}

export async function fetchCsv(
  url: string,
  request = fetch,
  backoff = delay,
  maxBytes?: number,
) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await request(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
      });
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.toLowerCase().includes("text/html")) {
        await response.body?.cancel();
        throw new SourceAccessError(
          "Link no longer public or moved",
          response.status,
          contentType,
        );
      }
      if (!response.ok) {
        await response.body?.cancel();
        const message = "Source returned HTTP " + response.status;
        if (response.status < 500 && response.status !== 429)
          throw new SourceAccessError(message, response.status, contentType);
        throw new Error(message);
      }
      const body = await readBody(response, maxBytes);
      if (/^\s*(?:<!doctype|<html\b)/i.test(body))
        throw new SourceAccessError(
          "Link no longer public or moved",
          response.status,
          contentType,
        );
      let rows: string[][];
      try {
        rows = decodeCsv(body);
      } catch {
        throw new SourceAccessError(
          "Source returned invalid CSV",
          response.status,
          contentType,
        );
      }
      const bytes = Buffer.byteLength(body);
      return { rows, bytes, status: response.status, contentType };
    } catch (error) {
      if (error instanceof SourceAccessError) throw error;
      if (attempt === 2)
        throw new Error(
          "CSV download failed after 3 attempts" +
            (error instanceof Error ? ": " + error.message : ""),
        );
      await backoff(500 * 2 ** attempt);
    }
  }
}
