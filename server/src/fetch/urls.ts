import type { Config, SourceKey } from "../config.js";
export function parseLink(link: string) {
  const url = URL.canParse(link) ? new URL(link) : null;
  const id = /^\/spreadsheets\/d\/([\w-]+)\/(?:edit|view)\/?$/.exec(
    url?.pathname ?? "",
  )?.[1];
  const gid =
    new URLSearchParams(url?.hash.slice(1)).get("gid") ??
    url?.searchParams.get("gid") ??
    "0";
  if (
    url?.protocol !== "https:" ||
    url.host !== "docs.google.com" ||
    !!url.username ||
    !!url.password ||
    !id ||
    !/^\d+$/.test(gid)
  )
    throw new Error("Expected a Google Sheets view link with a numeric GID");
  return { sheetId: id, gid };
}
export function exportUrl(sheetId: string, gid: string) {
  return (
    "https://docs.google.com/spreadsheets/d/" +
    sheetId +
    "/export?" +
    new URLSearchParams({ format: "csv", gid })
  );
}
export function sourceUrl(source: Config["sources"][SourceKey]) {
  if (!source.sheetId) throw new Error("Source link is not configured");
  if (source.mode === "export") return exportUrl(source.sheetId, source.gid);
  const params = new URLSearchParams({
    tqx: "out:csv",
    sheet: source.tab,
    headers: String(source.headerRows),
  });
  if (source.query) params.set("tq", source.query);
  return (
    "https://docs.google.com/spreadsheets/d/" +
    source.sheetId +
    "/gviz/tq?" +
    params
  );
}
