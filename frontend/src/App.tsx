import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { POS } from "./pages/POS";
import { Kitchen } from "./pages/Kitchen";
import { Orders } from "./pages/Orders";
import { Menu } from "./pages/Menu";
import { Inventory } from "./pages/Inventory";
import { Purchases } from "./pages/Purchases";
import { Expenses } from "./pages/Expenses";
import { Sales } from "./pages/Sales";
import { CashBank } from "./pages/CashBank";
import { ProfitLoss } from "./pages/ProfitLoss";
import { DailyClosing } from "./pages/DailyClosing";
import { Reports } from "./pages/Reports";
import { Staff } from "./pages/Staff";
import { SettingsPage } from "./pages/Settings";
import { Discounts } from "./pages/Discounts";
import { AuditLog } from "./pages/AuditLog";
import { RiderDashboard } from "./pages/RiderDashboard";
import { Role } from "./api/types";

/** Where a logged-in user lands when they hit a route their role can't use. */
function RoleHome() {
  const { user } = useAuth();
  return <Navigate to={user?.role === "RIDER" ? "/rider" : "/pos"} replace />;
}

function RequireAuth({ children, roles }: { children: JSX.Element; roles?: Role[] }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-400">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <RoleHome />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/rider" element={<RequireAuth roles={["RIDER"]}><RiderDashboard /></RequireAuth>} />
      <Route
        element={
          <RequireAuth roles={["ADMIN", "MANAGER", "STAFF"]}>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/dashboard" element={<RequireAuth roles={["ADMIN", "MANAGER"]}><Dashboard /></RequireAuth>} />
        <Route path="/pos" element={<POS />} />
        <Route path="/kitchen" element={<Kitchen />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/menu" element={<Menu />} />
        <Route path="/inventory" element={<RequireAuth roles={["ADMIN", "MANAGER"]}><Inventory /></RequireAuth>} />
        <Route path="/purchases" element={<RequireAuth roles={["ADMIN", "MANAGER"]}><Purchases /></RequireAuth>} />
        <Route path="/expenses" element={<RequireAuth roles={["ADMIN", "MANAGER"]}><Expenses /></RequireAuth>} />
        <Route path="/sales" element={<RequireAuth roles={["ADMIN", "MANAGER"]}><Sales /></RequireAuth>} />
        <Route path="/cash-bank" element={<RequireAuth roles={["ADMIN", "MANAGER"]}><CashBank /></RequireAuth>} />
        <Route path="/profit-loss" element={<RequireAuth roles={["ADMIN", "MANAGER"]}><ProfitLoss /></RequireAuth>} />
        <Route path="/daily-closing" element={<RequireAuth roles={["ADMIN", "MANAGER"]}><DailyClosing /></RequireAuth>} />
        <Route path="/reports" element={<RequireAuth roles={["ADMIN", "MANAGER"]}><Reports /></RequireAuth>} />
        <Route path="/staff" element={<RequireAuth roles={["ADMIN", "MANAGER"]}><Staff /></RequireAuth>} />
        <Route path="/settings" element={<RequireAuth roles={["ADMIN"]}><SettingsPage /></RequireAuth>} />
        <Route path="/discounts" element={<RequireAuth roles={["ADMIN"]}><Discounts /></RequireAuth>} />
        <Route path="/audit-log" element={<RequireAuth roles={["ADMIN"]}><AuditLog /></RequireAuth>} />
        <Route path="/" element={<RoleHome />} />
      </Route>
      <Route path="*" element={<RoleHome />} />
    </Routes>
  );
}
