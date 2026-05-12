import { Link, Route, Routes } from "react-router-dom";
import Landing from "./pages/Landing";
import Setup from "./pages/Setup";
import Dashboard from "./pages/Dashboard";
import Heartbeat from "./pages/Heartbeat";
import Director from "./pages/Director";
import AuditTrail from "./pages/AuditTrail";
import Verify from "./pages/Verify";
import { isMockMode } from "./lib/api";

function Header() {
  return (
    <header className="border-b border-neutral-900 sticky top-0 z-30 backdrop-blur bg-background/85">
      <div className="container-wide flex items-center justify-between py-4">
        <Link to={isMockMode() ? "/?mock=1" : "/"} className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-white to-neutral-400" />
          <span className="font-semibold tracking-tight text-lg">Heirloom</span>
        </Link>
        <nav className="flex items-center gap-5 text-sm text-neutral-400">
          <Link to="/dashboard" className="hover:text-white">Dashboard</Link>
          <Link to="/heartbeat" className="hover:text-white">Check in</Link>
          <Link to="/audit" className="hover:text-white">Audit</Link>
          <Link to="/verify" className="hover:text-white">Verify</Link>
        </nav>
      </div>
    </header>
  );
}

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/setup" element={<Setup />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/heartbeat" element={<Heartbeat />} />
          <Route path="/director" element={<Director />} />
          <Route path="/audit" element={<AuditTrail />} />
          <Route path="/verify" element={<Verify />} />
        </Routes>
      </main>
      <footer className="border-t border-neutral-900 py-6 text-center text-xs text-neutral-500">
        Heirloom — built on EigenCloud · alpha · {new Date().getFullYear()}
      </footer>
    </div>
  );
}
