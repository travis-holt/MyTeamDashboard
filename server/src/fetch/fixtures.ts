import { existsSync, readFileSync } from "node:fs";
import type { SourceKey } from "../config.js";
import { decodeCsv } from "./fetchCsv.js";
export function readFixture(source: SourceKey, sampleName: string = source) {
  const path = [
    "fixtures/local/" + source + ".csv",
    "fixtures/" + source + ".csv",
    "fixtures/" + sampleName + ".sample.csv",
  ].find(existsSync);
  if (!path) throw new Error("Missing fixture for " + source);
  const content = readFileSync(path, "utf8");
  return { rows: decodeCsv(content), bytes: Buffer.byteLength(content) };
}
