import { useCallback, useEffect, useState } from "react";
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const file = body instanceof Blob ? body : undefined;
  const response = await fetch("/api" + path, {
    method,
    signal,
    headers:
      body === undefined
        ? undefined
        : {
            "Content-Type": file
              ? "application/octet-stream"
              : "application/json",
          },
    body: body === undefined ? undefined : (file ?? JSON.stringify(body)),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && path !== "/login" && path !== "/me")
      window.dispatchEvent(new Event("dashboard:signout"));
    throw new ApiError(response.status, data.error ?? "Request failed");
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export function query(params: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value) search.set(key, value);
  return "?" + search.toString();
}
export function useApi<T>(path: string) {
  const [result, setResult] = useState<{
    path: string;
    data?: T;
    error?: string;
  } | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((value) => value + 1), []);
  const update = useCallback(
    (fn: (data: T) => T) =>
      setResult((old) =>
        old?.path === path && old.data !== undefined
          ? { ...old, data: fn(old.data) }
          : old,
      ),
    [path],
  );
  useEffect(() => {
    const handler = new AbortController();
    api<T>(path, "GET", undefined, handler.signal)
      .then((data) => setResult({ path, data }))
      .catch((error) => {
        if (!handler.signal.aborted) setResult({ path, error: message(error) });
      });
    return () => handler.abort();
  }, [path, version]);
  return { ...(result?.path === path ? result : null), reload, update };
}
export function message(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong";
}
