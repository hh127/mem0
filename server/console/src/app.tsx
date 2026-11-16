import { useEffect } from "react";
import type { ReactNode } from "react";
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query";
import { SessionProvider, useSession } from "@/lib/session";
import { ThemeProvider } from "@/lib/theme";
import { ToastProvider } from "@/ui/toast";
import { FullPageLoader } from "@/ui/feedback";
import { AppShell } from "@/features/layout/app-shell";
import { LoginPage } from "@/features/auth/login-page";
import { SetupPage } from "@/features/auth/setup-page";
import { NotFoundPage } from "@/features/misc/not-found-page";
import { MemoriesPage } from "@/features/memories/memories-page";
import { ReviewPage } from "@/features/review/review-page";
import { MapPage } from "@/features/map/map-page";
import { CategoriesPage } from "@/features/categories/categories-page";
import { CategoryManagePage } from "@/features/categories/manage-page";
import { CategoryTestPage } from "@/features/categories/test-page";
import { RequestsPage } from "@/features/requests/requests-page";
import { UsagePage } from "@/features/usage/usage-page";
import { EntitiesPage } from "@/features/entities/entities-page";
import { ApiKeysPage } from "@/features/api-keys/api-keys-page";
import { ConfigurationPage } from "@/features/configuration/configuration-page";
import { UsersPage } from "@/features/users/users-page";
import { SettingsPage } from "@/features/settings/settings-page";
import { AdminOnly } from "@/features/auth/admin-only";

function admin(element: ReactNode) {
  return <AdminOnly>{element}</AdminOnly>;
}

function useDocumentTitle() {
  const location = useLocation();
  useEffect(() => {
    const name = import.meta.env.VITE_INSTANCE_NAME || "Mem0";
    const section = location.pathname.split("/").filter(Boolean).pop() ?? "控制台";
    document.title = `${section} · ${name} 控制台`;
  }, [location.pathname]);
}

function RootLayout() {
  useDocumentTitle();
  return (
    <ToastProvider>
      <Outlet />
    </ToastProvider>
  );
}

function Gate() {
  const { status, user, needsSetup } = useSession();
  const location = useLocation();

  if (status === "loading") return <FullPageLoader label="正在校验会话…" />;
  if (needsSetup && location.pathname !== "/setup") {
    return <Navigate to="/setup" replace />;
  }
  if (status === "anonymous") {
    if (location.pathname === "/setup" && needsSetup) return <Outlet />;
    // Already on the login page: render it instead of navigating to itself, which
    // would re-trigger state updates on every render.
    if (location.pathname === "/login") return <Outlet />;
    return (
      <Navigate to="/login" replace state={{ from: location.pathname }} />
    );
  }
  if (!user) return <FullPageLoader label="正在加载账号…" />;
  if (location.pathname === "/login" || location.pathname === "/setup") {
    return <Navigate to="/memories" replace />;
  }
  return <Outlet />;
}

function NotFoundRoute() {
  return <NotFoundPage />;
}

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      {
        element: <Gate />,
        children: [
          { path: "/login", element: <LoginPage /> },
          { path: "/setup", element: <SetupPage /> },
          {
            element: <AppShell />,
            children: [
              { path: "/", element: <Navigate to="/memories" replace /> },
              { path: "/memories", element: <MemoriesPage /> },
              { path: "/review", element: admin(<ReviewPage />) },
              { path: "/map", element: <MapPage /> },
              { path: "/categories", element: admin(<CategoriesPage />) },
              { path: "/categories/manage", element: admin(<CategoryManagePage />) },
              { path: "/categories/test", element: admin(<CategoryTestPage />) },
              { path: "/requests", element: admin(<RequestsPage />) },
              { path: "/usage", element: admin(<UsagePage />) },
              { path: "/entities", element: admin(<EntitiesPage />) },
              // 普通用户也可以管理自己的 API key（后端按 created_by 隔离）。
              { path: "/api-keys", element: <ApiKeysPage /> },
              { path: "/configuration", element: admin(<ConfigurationPage />) },
              { path: "/users", element: admin(<UsersPage />) },
              { path: "/settings", element: <SettingsPage /> },
              { path: "*", element: <NotFoundRoute /> },
            ],
          },
        ],
      },
    ],
  },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SessionProvider>
          <RouterProvider router={router} />
        </SessionProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
