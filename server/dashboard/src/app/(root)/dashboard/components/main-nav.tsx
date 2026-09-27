"use client";

import * as React from "react";
import Link from "next/link";
import {
  Activity,
  ChevronRight,
  FlaskConical,
  FolderTree,
  GalleryVerticalEnd,
  Gauge,
  KeyRound,
  Settings,
  Settings2,
  Tag,
  Users,
  Wrench,
} from "lucide-react";
import { useSelector } from "react-redux";
import { RootState } from "@/store/store";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarGroupLabel,
} from "@/components/ui/sidebar";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { api } from "@/utils/api";
import { CATEGORY_ENDPOINTS } from "@/utils/api-endpoints";
import type { CategoryCatalog } from "@/types/api";

interface NavEntry {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
}

const MEMORY_NAV: NavEntry[] = [
  { title: "我的记忆", url: "/dashboard/memories", icon: GalleryVerticalEnd },
];

const ADMIN_NAV: NavEntry[] = [
  { title: "请求日志", url: "/dashboard/requests", icon: Activity },
  { title: "用量", url: "/dashboard/usage", icon: Gauge },
  { title: "实体", url: "/dashboard/entities", icon: Users },
  { title: "API 密钥", url: "/dashboard/api-keys", icon: KeyRound },
  { title: "配置", url: "/dashboard/configuration", icon: Wrench },
  { title: "设置", url: "/dashboard/settings", icon: Settings },
];

export function MainNav({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  const pathname = usePathname();
  const isSidebarCollapsed = useSelector(
    (state: RootState) => state.layout.isSidebarCollapsed,
  );
  // 18 个分类塞满侧边栏会像后台管理系统，所以默认折叠、只显示数量。
  const [categoriesOpen, setCategoriesOpen] = React.useState(false);
  const [categoryNames, setCategoryNames] = React.useState<string[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await api.get(CATEGORY_ENDPOINTS.BASE);
        const catalog = response.data as CategoryCatalog;
        if (!cancelled) setCategoryNames(catalog?.names ?? []);
      } catch {
        // 目录没加载出来不该毁掉导航，分类组保持为空即可
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const renderEntry = (item: NavEntry) => (
    <SidebarMenuItem key={item.url}>
      <SidebarMenuButton
        asChild
        collapsed={isSidebarCollapsed}
        active={pathname === item.url}
        tooltip={isSidebarCollapsed ? item.title : undefined}
      >
        <Link
          href={item.url}
          className={cn(
            "flex items-center w-full",
            isSidebarCollapsed ? "justify-center mx-auto" : "gap-1.5",
          )}
        >
          <item.icon className="size-4 shrink-0" />
          {!isSidebarCollapsed && <span>{item.title}</span>}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );

  const categoryActive = pathname.startsWith("/dashboard/categories");

  return (
    <Sidebar
      collapsible={isSidebarCollapsed ? "icon" : undefined}
      className={cn(className, "border-r-0 w-full mb-0 bg-transparent")}
      {...props}
    >
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu className="gap-0">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-0">
                {!isSidebarCollapsed && (
                  <SidebarGroupLabel className="mb-0">记忆</SidebarGroupLabel>
                )}
                {MEMORY_NAV.map(renderEntry)}
              </div>

              <div className="flex flex-col gap-0">
                {!isSidebarCollapsed ? (
                  <button
                    type="button"
                    onClick={() => setCategoriesOpen((open) => !open)}
                    className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-surface-default-secondary-hover"
                    aria-expanded={categoriesOpen}
                  >
                    <span className="flex items-center gap-1.5 text-xs font-medium text-onSurface-default-tertiary">
                      <FolderTree className="size-3.5" />
                      分类
                    </span>
                    <span className="flex items-center gap-1 text-xs text-onSurface-default-tertiary tabular-nums">
                      {categoryNames.length || ""}
                      <ChevronRight
                        className={cn(
                          "size-3.5 transition-transform",
                          categoriesOpen && "rotate-90",
                        )}
                      />
                    </span>
                  </button>
                ) : (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      collapsed
                      active={categoryActive}
                      tooltip="分类"
                    >
                      <Link
                        href="/dashboard/categories"
                        className="flex items-center justify-center mx-auto"
                      >
                        <FolderTree className="size-4" />
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}

                {!isSidebarCollapsed && categoriesOpen && (
                  <div className="flex flex-col gap-0 pt-1">
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        asChild
                        active={pathname === "/dashboard/categories"}
                      >
                        <Link
                          href="/dashboard/categories"
                          className="flex items-center w-full gap-1.5"
                        >
                          <Tag className="size-4 shrink-0" />
                          <span>分类浏览</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    {categoryNames.map((name) => (
                      <SidebarMenuItem key={name}>
                        <SidebarMenuButton asChild>
                          <Link
                            href={`/dashboard/memories?category=${encodeURIComponent(name)}`}
                            className="flex items-center w-full pl-6 text-xs"
                          >
                            <span className="truncate">{name}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        asChild
                        active={pathname === "/dashboard/categories/manage"}
                      >
                        <Link
                          href="/dashboard/categories/manage"
                          className="flex items-center w-full gap-1.5"
                        >
                          <Settings2 className="size-4 shrink-0" />
                          <span>分类管理</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        asChild
                        active={pathname === "/dashboard/categories/test"}
                      >
                        <Link
                          href="/dashboard/categories/test"
                          className="flex items-center w-full gap-1.5"
                        >
                          <FlaskConical className="size-4 shrink-0" />
                          <span>分类测试</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-0">
                {!isSidebarCollapsed && (
                  <SidebarGroupLabel className="mb-0">管理</SidebarGroupLabel>
                )}
                {ADMIN_NAV.map(renderEntry)}
              </div>
            </div>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
