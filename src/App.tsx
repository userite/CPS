import { useState } from "react";
import { AdminPage } from "./admin/AdminPage";
import { Dashboard } from "./components/Dashboard/Dashboard";

type View = "dashboard" | "admin";

export function App() {
  const [view, setView] = useState<View>("dashboard");
  return (
    <div className={view === "dashboard" ? "app-shell app-shell-fit" : "app-shell"}>
      <nav className="app-nav">
        <button type="button" aria-pressed={view === "dashboard"} onClick={() => setView("dashboard")}>
          Пулт
        </button>
        <button type="button" aria-pressed={view === "admin"} onClick={() => setView("admin")}>
          Администрация
        </button>
      </nav>
      {view === "dashboard" ? <Dashboard /> : <AdminPage />}
    </div>
  );
}
