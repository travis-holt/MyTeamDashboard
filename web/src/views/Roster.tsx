import { useState } from "react";
import type {
  Agent,
  DiscrepancyRow,
  RosterEvent,
  Scope,
} from "../../../server/src/api/dto";
import { query, useApi } from "../api";
import {
  DataTable,
  dateOffset,
  Empty,
  ErrorNotice,
  Loading,
  PageHeader,
  SearchBox,
  Section,
  tenure,
} from "../components/ui";
const eventLabel = {
  new: "Joined",
  left: "Left",
  moved: "Moved",
  rejoined: "Rejoined",
};

export function Roster({
  scope,
  today,
  openAgent,
}: {
  scope: Scope;
  today: string;
  openAgent: (code: string) => void;
}) {
  const agents = useApi<Omit<Agent, "fullName">[]>(
    "/agents" + query({ scope }),
  );
  const weekStart = dateOffset(today, -new Date(today).getUTCDay());
  const events = useApi<RosterEvent[]>(
    "/roster/events" + query({ scope, since: weekStart }),
  );
  const mismatches = useApi<DiscrepancyRow[]>(
    "/discrepancies" + query({ scope, rule: "D5", state: "open" }),
  );
  const [search, setSearch] = useState("");
  const error = agents.error || events.error || mismatches.error;
  function retry() {
    if (agents.error) agents.reload();
    if (events.error) events.reload();
    if (mismatches.error) mismatches.reload();
  }
  const visible = (agents.data ?? []).filter((agent) =>
    (agent.firstName + " " + agent.code + " " + agent.account)
      .toLowerCase()
      .includes(search.toLowerCase().trim()),
  );
  const current = events.data ?? [];
  const sections = [
    {
      title: "New this week",
      rows: current.filter(
        (row) => row.type === "new" || row.type === "rejoined",
      ),
      empty: "No new or returning agents this week.",
    },
    {
      title: "Left or moved",
      rows: current.filter(
        (row) => row.type === "left" || row.type === "moved",
      ),
      empty: "No departures or moves this week.",
    },
  ];
  return (
    <>
      <PageHeader
        title="Roster"
        description="Team membership and changes from the master sheet."
      />
      {error && <ErrorNotice retry={retry}>{error}</ErrorNotice>}
      <div className="roster-cards">
        {sections.map(({ title, rows, empty }) => (
          <Section key={title} title={title}>
            {!events.data && !events.error ? (
              <Loading />
            ) : rows.length ? (
              <ul className="compact-list">
                {rows.map((row) => (
                  <li key={row.id}>
                    <button
                      className="agent-link"
                      onClick={() => openAgent(row.code)}
                    >
                      {row.firstName || row.code}
                    </button>
                    <small>
                      {eventLabel[row.type]} · {row.date}
                      {row.detail && " · " + row.detail}
                    </small>
                  </li>
                ))}
              </ul>
            ) : (
              !events.error && <Empty>{empty}</Empty>
            )}
          </Section>
        ))}
        <Section title="Roster mismatches">
          {!mismatches.data && !mismatches.error ? (
            <Loading />
          ) : mismatches.data?.length ? (
            <ul className="compact-list">
              {mismatches.data.map((row) => (
                <li key={row.id}>
                  <button
                    className="agent-link"
                    onClick={() => openAgent(row.code)}
                  >
                    {row.firstName || row.code}
                  </button>
                  <small>{row.missing}</small>
                </li>
              ))}
            </ul>
          ) : (
            !mismatches.error && <Empty>No open roster mismatches.</Empty>
          )}
        </Section>
      </div>
      <Section
        title="Team list"
        action={<SearchBox value={search} onChange={setSearch} />}
      >
        {!agents.data && !agents.error ? (
          <Loading />
        ) : visible.length ? (
          <DataTable label="Team roster">
            <thead>
              <tr>
                <th>Name</th>
                <th>Code</th>
                <th>Account</th>
                <th>Hire date</th>
                <th>Tenure</th>
                <th>DTL</th>
                <th>Team Leader</th>
                <th>Group</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((agent) => (
                <tr key={agent.code}>
                  <td>
                    <button
                      className="agent-link"
                      onClick={() => openAgent(agent.code)}
                    >
                      {agent.firstName || agent.code}
                    </button>
                  </td>
                  <td className="mono">{agent.code}</td>
                  <td>{agent.account || "—"}</td>
                  <td className="mono nowrap">{agent.hireDate ?? "—"}</td>
                  <td>{tenure(agent.hireDate, today)}</td>
                  <td>{agent.dtl || "—"}</td>
                  <td>{agent.tl || "—"}</td>
                  <td>
                    <span className="group-tag">
                      {agent.ownerGroup === "mine" ? "My team" : "Covered"}
                    </span>
                  </td>
                  <td>{agent.active ? "Active" : "Inactive"}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        ) : (
          !agents.error && (
            <Empty>
              {search ? "No agents match your search." : "No agents loaded."}
            </Empty>
          )
        )}
      </Section>
    </>
  );
}
