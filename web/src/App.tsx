import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import {
  BrowserRouter,
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import {
  Activity,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronDown,
  ClipboardList,
  Layers3,
  LogOut,
  Moon,
  Settings as Gear,
  Sun,
  UsersRound,
} from "lucide-react";
import type { Scope, SyncStatus } from "../../server/src/api/dto";
import { api, useApi } from "./api";
import { ErrorNotice, Loading, syncLabel } from "./components/ui";
import { Login } from "./views/Login";
import { Today } from "./views/Today";
import { Discrepancies } from "./views/Discrepancies";
import { Roster } from "./views/Roster";
import { Agent } from "./views/Agent";
const Trends = lazy(() =>
  import("./views/Trends").then(({ Trends }) => ({ default: Trends })),
);
import { Settings } from "./views/Settings";

interface User {
  rosterName: string;
  alsoCover: string[];
  defaultScope: Scope;
}
const navigation = [
  { to: "/", label: "Today", Icon: CalendarDays },
  { to: "/discrepancies", label: "Discrepancies", Icon: ClipboardList },
  { to: "/trends", label: "Trends", Icon: ChartNoAxesCombined },
  { to: "/roster", label: "Roster", Icon: UsersRound },
  { to: "/settings", label: "Settings", Icon: Gear },
];

function Dashboard({
  user,
  dark,
  toggle,
  logout,
}: {
  user: User;
  dark: boolean;
  toggle: () => void;
  logout: () => void;
}) {
  const [scope, setScope] = useState<Scope>(user.defaultScope);
  const [date, setDate] = useState("");
  const [drawer, setDrawer] = useState<string | null>(null);
  const status = useApi<SyncStatus>("/sync/status");
  const location = useLocation();
  const openAgent = useCallback((code: string) => setDrawer(code), []);
  const closeAgent = useCallback(() => setDrawer(null), []);
  useEffect(() => {
    const timer = window.setInterval(
      status.reload,
      status.data?.running ? 1200 : 12000,
    );
    return () => window.clearInterval(timer);
  }, [status.reload, status.data?.running]);
  const sync = status.data ? syncLabel(status.data) : null;
  const today = status.data?.date ?? "";
  const chosen = date || today;
  const page =
    navigation.find((item) => item.to === location.pathname)?.label ?? "Agent";
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" to="/">
          <span className="brand-icon">
            <Layers3 size={20} />
          </span>
          <span>Team Dashboard</span>
        </Link>
        <div className="sidebar-main">
          <nav aria-label="Dashboard">
            {navigation.map(({ to, label, Icon }) => (
              <NavLink key={to} to={to} end={to === "/"}>
                <Icon size={18} />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="sidebar-bottom">
          <div className="user">
            <span className="avatar">
              {user.rosterName
                .split(/\s+/)
                .map((part) => part[0])
                .slice(0, 2)
                .join("")}
            </span>
            <span className="user-name">{user.rosterName}</span>
          </div>
          <button
            className="icon-button"
            aria-label="Sign out"
            onClick={logout}
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <div className="topbar">
          <span className="breadcrumb">{page}</span>
          <div className="top-controls">
            {sync && (
              <Link to="/settings" className={"sync-badge " + sync.tone}>
                <Activity size={14} />
                {sync.label}
              </Link>
            )}
            <label className="top-input">
              <span className="sr-only">Team scope</span>
              <select
                value={scope}
                onChange={(event) => setScope(event.target.value as Scope)}
              >
                <option value="mine">My team</option>
                <option value="covered">Covered team</option>
                <option value="all">All stored agents</option>
              </select>
              <ChevronDown size={13} />
            </label>
            {location.pathname === "/" && (
              <input
                className="date-control"
                type="date"
                aria-label="Dashboard date"
                value={chosen}
                min={status.data?.window.from}
                max={status.data?.window.to}
                onChange={(event) => setDate(event.target.value)}
              />
            )}
            <button
              className="icon-button theme-button"
              aria-label={
                dark ? "Switch to light theme" : "Switch to dark theme"
              }
              onClick={toggle}
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </div>
        <main className="content">
          {status.error && location.pathname !== "/settings" && (
            <ErrorNotice retry={status.reload}>{status.error}</ErrorNotice>
          )}
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route
                path="/"
                element={
                  <Today scope={scope} date={chosen} openAgent={openAgent} />
                }
              />
              <Route
                path="/discrepancies"
                element={<Discrepancies scope={scope} openAgent={openAgent} />}
              />
              <Route
                path="/trends"
                element={
                  today ? (
                    <Trends scope={scope} today={today} openAgent={openAgent} />
                  ) : (
                    !status.error && <Loading />
                  )
                }
              />
              <Route
                path="/roster"
                element={
                  today ? (
                    <Roster scope={scope} today={today} openAgent={openAgent} />
                  ) : (
                    !status.error && <Loading />
                  )
                }
              />
              <Route path="/agent/:code" element={<Agent today={today} />} />
              <Route path="/settings" element={<Settings status={status} />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>
      {drawer && (
        <Agent key={drawer} today={today} code={drawer} close={closeAgent} />
      )}
    </div>
  );
}
function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [dark, setDark] = useState(
    () => localStorage.getItem("dashboard-theme") === "dark",
  );
  const [authError, setAuthError] = useState("");
  const load = useCallback(() => {
    setAuthError("");
    api<User>("/me")
      .then(setUser)
      .catch((error) => {
        if (error.status !== 401) setAuthError(error.message);
        setUser(null);
      });
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    const handler = () => setUser(null);
    window.addEventListener("dashboard:signout", handler);
    return () => window.removeEventListener("dashboard:signout", handler);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("dashboard-theme", dark ? "dark" : "light");
  }, [dark]);
  const toggle = () => setDark((value) => !value);
  const logout = () => {
    void api("/logout", "POST")
      .then(() => setUser(null))
      .catch((error) => setAuthError(error.message));
  };
  if (user === undefined) return <Loading />;
  return (
    <BrowserRouter>
      {authError && <ErrorNotice retry={load}>{authError}</ErrorNotice>}
      {user ? (
        <Dashboard user={user} dark={dark} toggle={toggle} logout={logout} />
      ) : (
        <Login
          onLogin={() => {
            setAuthError("");
            load();
          }}
          dark={dark}
          toggle={toggle}
        />
      )}
    </BrowserRouter>
  );
}
export default App;
