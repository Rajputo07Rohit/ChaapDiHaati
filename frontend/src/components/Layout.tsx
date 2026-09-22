import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  ShoppingCart,
  ClipboardList,
  BookOpen,
  Boxes,
  Truck,
  Receipt,
  TrendingUp,
  Wallet,
  PieChart,
  CalendarCheck,
  FileBarChart,
  Users,
  Settings as SettingsIcon,
  History,
  Percent,
  ChefHat,
  Menu as MenuIcon,
  X,
  LogOut,
  Sun,
  Moon,
  Contrast,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { Role } from "../api/types";
import { AppTheme, applyTheme, getStoredTheme } from "../utils/theme";
import logo from "../assets/logo.png";

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles: Role[];
}

const NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["ADMIN", "MANAGER"] },
  { to: "/pos", label: "POS / New Order", icon: ShoppingCart, roles: ["ADMIN", "MANAGER", "STAFF"] },
  { to: "/kitchen", label: "Kitchen", icon: ChefHat, roles: ["ADMIN", "MANAGER", "STAFF"] },
  { to: "/orders", label: "Orders", icon: ClipboardList, roles: ["ADMIN", "MANAGER", "STAFF"] },
  { to: "/menu", label: "Menu", icon: BookOpen, roles: ["ADMIN", "MANAGER", "STAFF"] },
  { to: "/inventory", label: "Inventory", icon: Boxes, roles: ["ADMIN", "MANAGER"] },
  { to: "/purchases", label: "Purchases", icon: Truck, roles: ["ADMIN", "MANAGER"] },
  { to: "/expenses", label: "Expenses", icon: Receipt, roles: ["ADMIN", "MANAGER"] },
  { to: "/sales", label: "Sales", icon: TrendingUp, roles: ["ADMIN", "MANAGER"] },
  { to: "/cash-bank", label: "Cash & Bank", icon: Wallet, roles: ["ADMIN", "MANAGER"] },
  { to: "/profit-loss", label: "Profit & Loss", icon: PieChart, roles: ["ADMIN", "MANAGER"] },
  { to: "/daily-closing", label: "Daily Closing", icon: CalendarCheck, roles: ["ADMIN", "MANAGER"] },
  { to: "/reports", label: "Reports", icon: FileBarChart, roles: ["ADMIN", "MANAGER"] },
  { to: "/staff", label: "Staff", icon: Users, roles: ["ADMIN", "MANAGER"] },
  { to: "/discounts", label: "Discounts", icon: Percent, roles: ["ADMIN"] },
  { to: "/settings", label: "Settings", icon: SettingsIcon, roles: ["ADMIN"] },
  { to: "/audit-log", label: "Audit Log", icon: History, roles: ["ADMIN"] },
];

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [theme, setTheme] = useState<AppTheme>(getStoredTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  if (!user) return null;
  const items = NAV.filter((i) => i.roles.includes(user.role));

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 inset-x-0 h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 z-40">
        <button onClick={() => setMobileOpen(true)} className="text-slate-600">
          <MenuIcon size={22} />
        </button>
        <span className="font-semibold text-brand-700 flex items-center gap-2">
          <img src={logo} alt="" className="w-7 h-7 object-contain" />
          Chaap Di Haati
        </span>
        <div className="w-6" />
      </div>

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-slate-900 text-slate-200 flex flex-col transform transition-transform lg:transform-none ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <img src={logo} alt="" className="w-9 h-9 object-contain shrink-0" />
            <div className="min-w-0">
              <div className="font-bold text-white leading-tight truncate">Chaap Di Haati</div>
              <div className="text-[11px] text-slate-400">Restaurant Management</div>
            </div>
          </div>
          <button className="lg:hidden text-slate-400 shrink-0" onClick={() => setMobileOpen(false)}>
            <X size={20} />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? "bg-brand-600 text-white" : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`
              }
            >
              <item.icon size={18} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-slate-800">
          <div className="px-3 py-2 text-xs text-slate-400">
            <div className="font-medium text-slate-200">{user.fullName}</div>
            <div>{user.role}</div>
          </div>
          <div className="px-3 pb-2">
            <div className="text-[11px] text-slate-500 uppercase tracking-wide mb-1.5">Theme</div>
            <div className="grid grid-cols-3 gap-1 bg-slate-800 rounded-lg p-1">
              {(
                [
                  { value: "light", label: "Light", icon: Sun },
                  { value: "dark", label: "Dark", icon: Moon },
                  { value: "mono", label: "B&W", icon: Contrast },
                ] as { value: AppTheme; label: string; icon: typeof Sun }[]
              ).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setTheme(opt.value)}
                  title={opt.value === "mono" ? "Billing black & white" : `${opt.label} theme`}
                  className={`flex flex-col items-center gap-0.5 py-1.5 rounded-md text-[11px] transition-colors ${
                    theme === opt.value ? "bg-brand-600 text-white" : "text-slate-400 hover:text-white"
                  }`}
                >
                  <opt.icon size={14} />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <LogOut size={16} /> Log out
          </button>
        </div>
      </aside>

      {mobileOpen && <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={() => setMobileOpen(false)} />}

      <main className="flex-1 overflow-y-auto pt-14 lg:pt-0">
        <div className="max-w-[1400px] mx-auto p-4 md:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
