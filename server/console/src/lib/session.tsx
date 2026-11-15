import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { PropsWithChildren } from "react";
import {
  API_BASE,
  ApiError,
  api,
  configureAuth,
  getAccessToken,
  setAccessToken,
} from "@/lib/api";
import type { AuthUser, SetupStatus, TokenResponse } from "@/lib/types";

const REFRESH_STORAGE_KEY = "mem0_console_refresh";
const REFRESH_FALLBACK = import.meta.env.VITE_REFRESH_TOKEN_FALLBACK === "true";

type SessionStatus = "loading" | "anonymous" | "authenticated";

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
}

export interface SessionValue {
  status: SessionStatus;
  user: AuthUser | null;
  isAdmin: boolean;
  needsSetup: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  register: (input: RegisterInput) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  reload: () => Promise<void>;
  completeOnboarding: (useCase: string) => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

function storeFallbackRefreshToken(token: string | null) {
  if (!REFRESH_FALLBACK) return;
  try {
    if (token) sessionStorage.setItem(REFRESH_STORAGE_KEY, token);
    else sessionStorage.removeItem(REFRESH_STORAGE_KEY);
  } catch {
    // sessionStorage 不可用（隐私模式）时静默降级为仅 cookie 会话。
  }
}

function readFallbackRefreshToken(): string | null {
  if (!REFRESH_FALLBACK) return null;
  try {
    return sessionStorage.getItem(REFRESH_STORAGE_KEY);
  } catch {
    return null;
  }
}

async function refreshWithCookie(): Promise<Response> {
  return fetch(`${API_BASE}/auth/refresh`, {
    method: "POST",
    credentials: "include",
  });
}

async function refreshWithBody(token: string): Promise<Response> {
  return fetch(`${API_BASE}/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: token }),
  });
}

async function applyRefreshResponse(response: Response): Promise<boolean> {
  if (!response.ok) return false;
  const data = (await response.json()) as TokenResponse;
  setAccessToken(data.access_token);
  storeFallbackRefreshToken(data.refresh_token);
  return true;
}

async function requestRefresh(): Promise<boolean> {
  try {
    if (await applyRefreshResponse(await refreshWithCookie())) return true;

    // 兼容尚未下发 cookie 的旧服务端：显式回退到 sessionStorage 中的令牌。
    const fallback = readFallbackRefreshToken();
    if (fallback && (await applyRefreshResponse(await refreshWithBody(fallback)))) {
      return true;
    }
    storeFallbackRefreshToken(null);
    return false;
  } catch {
    return false;
  }
}

async function fetchMe(): Promise<AuthUser> {
  return api.get<AuthUser>("/auth/me");
}

export function SessionProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);

  const reload = useCallback(async () => {
    setStatus("loading");
    try {
      const setup = await api.get<SetupStatus>("/auth/setup-status");
      setNeedsSetup(setup.needsSetup);
    } catch {
      // setup-status 不可达不应阻塞登录页；按已初始化处理。
      setNeedsSetup(false);
    }
    if (!(await requestRefresh())) {
      setAccessToken(null);
      setUser(null);
      setStatus("anonymous");
      return;
    }
    try {
      const me = await fetchMe();
      setUser(me);
      setStatus("authenticated");
    } catch {
      setAccessToken(null);
      setUser(null);
      setStatus("anonymous");
    }
  }, []);

  useEffect(() => {
    configureAuth({
      refresh: requestRefresh,
      onUnauthorized: () => {
        setAccessToken(null);
        setUser(null);
        setStatus("anonymous");
      },
    });
    void reload();
  }, [reload]);

  const applyTokens = useCallback(async (tokens: TokenResponse) => {
    setAccessToken(tokens.access_token);
    storeFallbackRefreshToken(tokens.refresh_token);
    const me = await fetchMe();
    setUser(me);
    setStatus("authenticated");
    setNeedsSetup(false);
    return me;
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const tokens = await api.post<TokenResponse>(
        "/auth/login",
        { email, password },
        { skipAuthRefresh: true },
      );
      return applyTokens(tokens);
    },
    [applyTokens],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      const tokens = await api.post<TokenResponse>("/auth/register", input, {
        skipAuthRefresh: true,
      });
      return applyTokens(tokens);
    },
    [applyTokens],
  );

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout", undefined, { skipAuthRefresh: true });
    } catch (error) {
      // 旧服务端没有 /auth/logout：本地清理仍然有效。
      if (!(error instanceof ApiError)) throw error;
    }
    storeFallbackRefreshToken(null);
    setAccessToken(null);
    setUser(null);
    setStatus("anonymous");
  }, []);

  const refreshUser = useCallback(async () => {
    if (!getAccessToken()) return;
    const me = await fetchMe();
    setUser(me);
  }, []);

  const completeOnboarding = useCallback(async (useCase: string) => {
    await api.post("/auth/onboarding-complete", { use_case: useCase });
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      user,
      isAdmin: user?.role === "admin",
      needsSetup,
      login,
      register,
      logout,
      refreshUser,
      reload,
      completeOnboarding,
    }),
    [
      status,
      user,
      needsSetup,
      login,
      register,
      logout,
      refreshUser,
      reload,
      completeOnboarding,
    ],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession 必须在 SessionProvider 内使用");
  return context;
}
