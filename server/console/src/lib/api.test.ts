import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  api,
  ApiError,
  configureAuth,
  setAccessToken,
} from "@/lib/api";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("api client", () => {
  beforeEach(() => {
    setAccessToken(null);
    configureAuth({ refresh: async () => false, onUnauthorized: () => {} });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the access token and parses JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    setAccessToken("access-123");

    await expect(api.get<{ ok: boolean }>("/memories")).resolves.toEqual({ ok: true });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/memories");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer access-123",
    );
    expect(init.credentials).toBe("include");
  });

  it("serialises query parameters, repeating arrays", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);

    await api.get("/memories", {
      user_id: "u1",
      category: ["a", "b"],
      empty: "",
      missing: undefined,
    });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("user_id=u1");
    expect(url).toContain("category=a&category=b");
    expect(url).not.toContain("empty=");
    expect(url).not.toContain("missing=");
  });

  it("maps a string detail to an ApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, { detail: "参数不合法" })));

    await expect(api.post("/memories", {})).rejects.toMatchObject({
      message: "参数不合法",
      status: 400,
    });
  });

  it("maps a pydantic validation array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(422, { detail: [{ msg: "field required" }] })),
    );

    const error = (await api
      .post("/memories", {})
      .catch((reason: unknown) => reason)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe("field required");
    expect(error.status).toBe(422);
  });

  it("refreshes once on 401 and retries the request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { detail: "expired" }))
      .mockResolvedValueOnce(jsonResponse(200, { retried: true }));
    vi.stubGlobal("fetch", fetchMock);
    const refresh = vi.fn(async () => {
      setAccessToken("fresh-token");
      return true;
    });
    configureAuth({ refresh, onUnauthorized: () => {} });

    await expect(api.get<{ retried: boolean }>("/auth/me")).resolves.toEqual({
      retried: true,
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, retryInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect((retryInit.headers as Record<string, string>).Authorization).toBe(
      "Bearer fresh-token",
    );
  });

  it("calls the unauthorized handler when refresh fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, {})));
    const onUnauthorized = vi.fn();
    configureAuth({ refresh: async () => false, onUnauthorized });

    await expect(api.get("/auth/me")).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("maps network failures to status 0", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("failed")));

    await expect(api.get("/memories")).rejects.toMatchObject({
      status: 0,
      message: "网络不可达，检查服务端是否在线",
    });
  });

  it("does not refresh when the caller opts out", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, {}));
    vi.stubGlobal("fetch", fetchMock);
    const refresh = vi.fn(async () => true);
    configureAuth({ refresh, onUnauthorized: () => {} });

    await expect(
      api.post("/auth/login", {}, { skipAuthRefresh: true }),
    ).rejects.toMatchObject({ status: 401 });
    expect(refresh).not.toHaveBeenCalled();
  });
});
