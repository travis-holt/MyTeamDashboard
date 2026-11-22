import { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { DiscrepancyRow, Scope } from "../../../server/src/api/dto";
import { api, message, query, useApi } from "../api";
import {
  CardCell,
  DataTable,
  Empty,
  ErrorNotice,
  Loading,
  PageHeader,
  SearchBox,
  Section,
} from "../components/ui";
const options = ["open", "ack", "resolved"] as const;
const labels = { open: "Open", ack: "Acknowledged", resolved: "Resolved" };

export function Discrepancies({
  scope,
  openAgent,
}: {
  scope: Scope;
  openAgent: (code: string) => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rule, setRule] = useState("");
  const [state, setState] = useState("open");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const filters = { scope, from, to, rule, state, q };
  const result = useApi<DiscrepancyRow[]>("/discrepancies" + query(filters));
  const visible = result.data ?? [];
  const checked = visible
    .filter((row) => selected.has(row.id))
    .map((row) => row.id);
  const allSelected = visible.length > 0 && checked.length === visible.length;
  const selectAll = (include: boolean) =>
    setSelected(include ? new Set(visible.map((row) => row.id)) : new Set());
  const toggle = (id: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  async function change(
    id: string,
    patch: Partial<Pick<DiscrepancyRow, "state" | "tlComment">>,
  ) {
    setError("");
    try {
      const updated = await api<DiscrepancyRow>(
        "/discrepancies/" + encodeURIComponent(id),
        "PATCH",
        patch,
      );
      result.update((rows) =>
        rows.flatMap((row) =>
          row.id !== id
            ? [row]
            : state === "all" || updated.state === state
              ? [updated]
              : [],
        ),
      );
    } catch (error) {
      setError(message(error));
    }
  }
  async function resolveSelected() {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await api("/discrepancies/bulk", "PATCH", {
        ids: checked,
        state: "resolved",
      });
      setSelected(new Set());
      result.reload();
      setNotice("Selected discrepancies resolved.");
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    setError("");
    setNotice("");
    const request = api<{ html: string; tsv: string }>(
      "/discrepancies/export" + query({ ...filters, ids: checked.join(",") }),
    );
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({
              "text/html": request.then(
                (data) => new Blob([data.html], { type: "text/html" }),
              ),
              "text/plain": request.then(
                (data) => new Blob([data.tsv], { type: "text/plain" }),
              ),
            }),
          ]);
        } catch {
          await navigator.clipboard.writeText((await request).tsv);
        }
      } else {
        const text = (await request).tsv;
        const area = document.createElement("textarea");
        area.value = text;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.append(area);
        area.select();
        try {
          if (!document.execCommand("copy"))
            throw new Error("Clipboard access is unavailable");
        } finally {
          area.remove();
        }
      }
      setNotice("Table copied.");
    } catch (error) {
      setError(message(error));
    }
  }
  return (
    <>
      <PageHeader
        title="Discrepancies"
        description="Review attendance and schedule exceptions."
      />
      <Section
        title="Review queue"
        action={
          <button
            className="secondary"
            onClick={() => void copy()}
            disabled={!visible.length}
          >
            <Copy size={15} /> Copy as email table
          </button>
        }
      >
        <div className="filter-row">
          <SearchBox value={q} onChange={setQ} />
          <label>
            From
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
          <label>
            Rule
            <select
              value={rule}
              onChange={(event) => setRule(event.target.value)}
            >
              <option value="">All rules</option>
              {[1, 2, 3, 4, 5, 6, 7].map((value) => (
                <option key={value}>D{value}</option>
              ))}
            </select>
          </label>
          <label>
            State
            <select
              value={state}
              onChange={(event) => setState(event.target.value)}
            >
              <option value="all">All states</option>
              {options.map((value) => (
                <option key={value} value={value}>
                  {labels[value]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {result.error && (
          <ErrorNotice retry={result.reload}>{result.error}</ErrorNotice>
        )}
        {error && <ErrorNotice>{error}</ErrorNotice>}
        {notice && (
          <div className="notice" role="status">
            <Check size={16} />
            {notice}
          </div>
        )}
        {checked.length > 0 && (
          <div className="selection">
            <span>{checked.length} selected</span>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void resolveSelected()}
            >
              Mark resolved
            </button>
          </div>
        )}
        {visible.length > 0 && (
          <div className="mobile-table-controls">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(event) => selectAll(event.target.checked)}
              />
              Select all visible
            </label>
          </div>
        )}
        {!result.data && !result.error ? (
          <Loading />
        ) : visible.length > 0 ? (
          <DataTable label="Discrepancies" cards>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select all visible"
                    checked={allSelected}
                    onChange={(event) => selectAll(event.target.checked)}
                  />
                </th>
                <th>Code</th>
                <th>Name</th>
                <th>Team Leader</th>
                <th>Account</th>
                <th>Date</th>
                <th>Missing</th>
                <th>TL Comment</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {visible.map((row) => (
                <tr role="row" key={row.id}>
                  <CardCell label="Selection">
                    <input
                      type="checkbox"
                      aria-label={"Select " + row.code + " " + row.ruleId}
                      checked={selected.has(row.id)}
                      onChange={() => toggle(row.id)}
                    />
                  </CardCell>
                  <CardCell label="Code" className="mono">
                    {row.code}
                  </CardCell>
                  <CardCell label="Name">
                    <button
                      className="agent-link"
                      onClick={() => openAgent(row.code)}
                    >
                      {row.firstName || row.code}
                    </button>
                  </CardCell>
                  <CardCell label="Team Leader">{row.tl || "—"}</CardCell>
                  <CardCell label="Account">{row.account || "—"}</CardCell>
                  <CardCell label="Date" className="mono nowrap">
                    {row.date}
                  </CardCell>
                  <CardCell label="Missing">
                    <span className="rule-tag">{row.ruleId}</span> {row.missing}
                  </CardCell>
                  <CardCell label="TL Comment">
                    <input
                      className="comment"
                      aria-label={
                        "TL Comment for " + row.code + " " + row.ruleId
                      }
                      key={row.tlComment}
                      defaultValue={row.tlComment}
                      placeholder="Add comment"
                      onBlur={(event) => {
                        if (event.target.value !== row.tlComment)
                          void change(row.id, {
                            tlComment: event.target.value,
                          });
                      }}
                    />
                  </CardCell>
                  <CardCell label="State">
                    <select
                      aria-label={"State for " + row.code + " " + row.ruleId}
                      value={row.state}
                      onChange={(event) =>
                        void change(row.id, {
                          state: event.target.value as DiscrepancyRow["state"],
                        })
                      }
                    >
                      {options.map((value) => (
                        <option key={value} value={value}>
                          {labels[value]}
                        </option>
                      ))}
                    </select>
                  </CardCell>
                </tr>
              ))}
            </tbody>
          </DataTable>
        ) : (
          !result.error && <Empty>No discrepancies match these filters.</Empty>
        )}
      </Section>
    </>
  );
}
