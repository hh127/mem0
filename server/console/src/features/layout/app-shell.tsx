import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  Gauge,
  KeyRound,
  Library,
  LogOut,
  Menu,
  Moon,
  Network,
  Settings,
  Sun,
  Tag,
  UserCog,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import { Button, buttonClass } from "@/ui/primitives";

interface NavItem {
  to: string;
  label: string;
  icon: typeof Library;
}

const MEMORY_NAV: NavItem[] = [
  { to: "/memories", label: "记忆库", icon: Library },
  { to: "/map", label: "记忆地图", icon: Network },
];

const ADMIN_NAV: NavItem[] = [
  { to: "/categories", label: "分类", icon: Tag },
  { to: "/requests", label: "请求日志", icon: Activity },
  { to: "/usage", label: "用量", icon: Gauge },
  { to: "/entities", label: "实体", icon: Users },
  { to: "/api-keys", label: "API 密钥", icon: KeyRound },
  { to: "/users", label: "用户", icon: UserCog },
  { to: "/configuration", label: "配置", icon: Wrench },
];

function NavSection({ title, items }: { title: string; items: NavItem[] }) {
  return (
    <div className="space-y-1">
      <p className="px-2 text-[11px] font-medium uppercase tracking-[0.18em] text-ink-faint">
        {title}
      </p>
      <nav className="flex flex-col gap-0.5">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                isActive
                  ? "bg-accent-soft text-accent"
                  : "text-ink-soft hover:bg-panel-2 hover:text-ink",
              )
            }
          >
            <item.icon className="size-4 shrink-0" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, isAdmin, logout } = useSession();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const instanceName = import.meta.env.VITE_INSTANCE_NAME || "Mem0";

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-5">
      <div className="flex items-center gap-2.5 px-1.5">
        <div className="grid size-8 place-items-center rounded-lg bg-ink text-paper">
          <span className="font-display text-sm">M</span>
        </div>
        <div className="min-w-0">
          <p className="truncate font-display text-[15px] leading-5 text-ink">
            {instanceName} 控制台
          </p>
          <p className="text-[11px] leading-4 text-ink-faint">自托管 · 中文优先</p>
        </div>
      </div>

      <div className="flex-1 space-y-5">
        <NavSection title="记忆" items={MEMORY_NAV} />
        {isAdmin ? <NavSection title="管理" items={ADMIN_NAV} /> : null}
      </div>

      <div className="space-y-2 border-t border-line pt-3">
        {!isAdmin ? (
          <NavLink
            to="/api-keys"
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                isActive
                  ? "bg-accent-soft text-accent"
                  : "text-ink-soft hover:bg-panel-2 hover:text-ink",
              )
            }
          >
            <KeyRound className="size-4" />
            <span>我的 API 密钥</span>
          </NavLink>
        ) : null}
        <NavLink
          to="/settings"
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
              isActive
                ? "bg-accent-soft text-accent"
                : "text-ink-soft hover:bg-panel-2 hover:text-ink",
            )
          }
        >
          <Settings className="size-4" />
          <span>设置</span>
        </NavLink>
        <button
          type="button"
          onClick={toggle}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-ink-soft transition-colors hover:bg-panel-2 hover:text-ink"
        >
          {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          <span>{theme === "dark" ? "浅色模式" : "深色模式"}</span>
        </button>

        <div className="rounded-lg border border-line bg-panel-2/60 px-2.5 py-2.5">
          <p className="truncate text-sm font-medium text-ink">{user?.name || "未命名"}</p>
          <p className="truncate text-[11px] text-ink-faint">{user?.email}</p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="rounded-full border border-line px-1.5 py-0.5 text-[10px] text-ink-faint">
              {isAdmin ? "管理员" : "普通用户"}
            </span>
            <Button variant="ghost" size="sm" onClick={handleLogout} className="h-6 px-1.5 text-[11px]">
              <LogOut className="size-3" />
              退出
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-dvh bg-paper">
      <a href="#main" className="skip-link">
        跳到主要内容
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[252px] border-r border-line bg-panel md:block">
        <SidebarContent />
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="关闭导航"
            className="absolute inset-0 bg-ink/40"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-[272px] border-r border-line bg-panel shadow-xl">
            <div className="flex items-center justify-end px-3 pt-3">
              <Button variant="ghost" size="icon" aria-label="关闭导航" onClick={() => setMobileOpen(false)}>
                <X className="size-4" />
              </Button>
            </div>
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      ) : null}

      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-paper/85 px-4 py-2.5 backdrop-blur md:hidden">
        <button
          type="button"
          className={buttonClass("ghost", "icon")}
          aria-label="打开导航"
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="size-4" />
        </button>
        <p className="font-display text-sm text-ink">
          {import.meta.env.VITE_INSTANCE_NAME || "Mem0"} 控制台
        </p>
        <span className="w-8" />
      </header>

      <main id="main" className="px-4 py-6 md:pl-[calc(252px+2rem)] md:pr-8 md:py-8">
        <div className="mx-auto w-full max-w-[1180px]">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
