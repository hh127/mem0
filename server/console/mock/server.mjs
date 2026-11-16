// In-memory mock of the Mem0 server API, for developing the console without Docker.
//
//   pnpm mock        listen on http://127.0.0.1:8899
//   MOCK_EMPTY=1 pnpm mock   start with no users (exercise the setup wizard)
//
// Routes mirror the FastAPI server (paths without the /api prefix that Vite/nginx
// strip). Shape and auth rules follow server/main.py and server/routers/*.py.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.MOCK_PORT || 9200);
const EMPTY = process.env.MOCK_EMPTY === "1";

// ---------------------------------------------------------------- categories
function loadCatalog() {
  try {
    const raw = JSON.parse(
      readFileSync(resolve(__dirname, "../../categories.json"), "utf8"),
    );
    const entries = (raw.categories || []).map((c) => ({
      name: c.name,
      description: c.description,
      enabled: true,
    }));
    return { entries, rules: raw.decision_rules || [] };
  } catch {
    return {
      entries: [
        { name: "个人信息", description: "个人基本信息", enabled: true },
        { name: "个人偏好", description: "偏好与喜好", enabled: true },
      ],
      rules: [],
    };
  }
}

const catalogState = loadCatalog();

// -------------------------------------------------------------------- helpers
const now = () => new Date().toISOString();
const daysAgo = (days) =>
  new Date(Date.now() - days * 86_400_000).toISOString();
const uid = () => randomUUID();

function send(res, status, body, headers = {}) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(payload);
}

const bad = (res, status, detail, extra = {}) =>
  send(res, status, { detail, ...extra });

const ok = (res, body = { message: "ok" }) => send(res, 200, body);

/** Deep merge used by POST /configure, mirroring the server's nested section merge. */
function deepMerge(base, override) {
  const merged = base && typeof base === "object" && !Array.isArray(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(override || {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      merged[key] = deepMerge(merged[key], value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(
      part.slice(index + 1).trim(),
    );
  }
  return out;
}

function setRefreshCookie(refreshToken) {
  return {
    "Set-Cookie": `mem0_console_rt=${refreshToken}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`,
  };
}

function clearRefreshCookie() {
  return {
    "Set-Cookie":
      "mem0_console_rt=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0",
  };
}

const ACCESS_PREFIX = "mock-access.";
const REFRESH_PREFIX = "mock-refresh.";

function issueTokens(user) {
  return {
    access_token: `${ACCESS_PREFIX}${user.id}.${user.role}`,
    refresh_token: `${REFRESH_PREFIX}${user.id}`,
    token_type: "bearer",
  };
}

function userById(id) {
  return DB.users.find((u) => u.id === id) ?? null;
}

function userFromRequest(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) {
    const token = header.slice(7);
    if (token.startsWith(ACCESS_PREFIX)) {
      const rest = token.slice(ACCESS_PREFIX.length);
      const [userId, role] = rest.split(".");
      const user = userById(userId);
      if (user && user.role === role && user.is_active !== false) return user;
    }
  }
  const apiKey = req.headers["x-api-key"];
  if (typeof apiKey === "string" && apiKey.startsWith("mem0_sk_")) {
    const owner = DB.apiKeys.find(
      (k) => k.key === apiKey && !k.revoked_at,
    );
    if (owner) return userById(owner.created_by);
  }
  if (process.env.MOCK_AUTH_DISABLED === "1") {
    return DB.users.find((u) => u.role === "admin") ?? null;
  }
  return null;
}

function scopeOf(user) {
  return user && user.role !== "admin" ? user.memory_scope ?? null : null;
}

function requireAuth(req, res) {
  const user = userFromRequest(req);
  if (!user) {
    bad(res, 401, "Authentication required. Provide a Bearer token or X-API-Key header.");
    return null;
  }
  return user;
}

function requireAdmin(req, res) {
  const user = requireAuth(req, res);
  if (!user) return null;
  if (user.role !== "admin") {
    bad(res, 403, "Admin role required.");
    return null;
  }
  return user;
}

// --------------------------------------------------------------------- seeds
const USERS = EMPTY
  ? []
  : [
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "管理员",
        email: "admin@example.com",
        password: "admin12345678",
        role: "admin",
        memory_scope: null,
        is_active: true,
        created_at: daysAgo(120),
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        name: "小何",
        email: "user@example.com",
        password: "user12345678",
        role: "user",
        memory_scope: "hermes-user-2",
        is_active: true,
        created_at: daysAgo(60),
      },
    ];

const CATEGORY_SAMPLES = {
  个人信息: "用户在杭州从事工程造价相关工作，具有土木工程教育背景。",
  个人偏好: "用户喜欢简洁克制的界面，偏好开源软件而不是商业 SaaS。",
  行为习惯: "用户处理项目时通常先做成本分析，再把方案落到文档里。",
  工作信息: "用户负责工程项目商务与成本管理，日常以目标成本控制为主。",
  工作项目: "用户正在负责某高中建设项目的成本分析与阶段性结算。",
  专业知识: "工程造价中的成本控制需要结合目标成本与实际成本动态分析。",
  技术能力: "用户能够使用 Python、TypeScript 与 Docker 完成自动化开发。",
  开发项目: "用户正在开发 SmartQuant 工程造价计算工具，包含清单解析模块。",
  设备环境: "用户使用一台群晖 NAS 运行自托管服务，并通过 UPS 供电。",
  软件与服务: "用户在 NAS 上部署了 Mem0 与 Nginx Proxy Manager。",
  网络与基础设施: "多个 Docker 服务通过统一 Docker 网络接入反向代理。",
  长期目标: "用户希望长期完善自己的工程造价数字化工具链。",
  短期任务: "本周需要完成 Mem0-CN 分类系统的面板联调。",
  重要决策: "以后所有 Docker 服务统一加入 nginx-net 网络。",
  关系与人物: "老王是用户在项目中的长期合作伙伴，负责现场施工协调。",
  重要事件: "用户曾主导完成一个工程造价数字化项目并参加行业比赛。",
  知识收藏: "这个 GitHub 仓库以后做 Mem0-CN 时可以参考，先收藏。",
  AI助手设置: "以后回答问题时先给结论，再给解释，代码要完整可运行。",
};

const MEMORY_TEXTS = [
  ["个人信息", "用户名叫何工，常驻杭州，做工程造价已经八年。"],
  ["个人偏好", "用户偏好深色界面，阅读文档时喜欢先看示例。"],
  ["行为习惯", "用户习惯周日晚上整理下周的待办清单。"],
  ["工作信息", "用户所在团队负责集团所有基建项目的成本复核。"],
  ["工作项目", "某小学改扩建项目的进度款审核这周进入尾声。"],
  ["专业知识", "清单计价里甲供材料的扣税方式容易出错，需要单独确认。"],
  ["技术能力", "用户会写 VBA 宏来批量处理 Excel 工程量清单。"],
  ["开发项目", "SmartQuant 的向量检索模块正在替换成 pgvector。"],
  ["设备环境", "用户的主力机是 Windows 台式机，另外有一台 MacBook。"],
  ["软件与服务", "用户用 OpenClaw 连接本地模型与 Mem0 记忆服务。"],
  ["网络与基础设施", "家里的 Tailscale 子网路由把 NAS 暴露给笔记本。"],
  ["长期目标", "用户计划三年内把造价工具做成可交付的产品。"],
  ["短期任务", "周五之前要把 Mem0-CN 的 README 补完。"],
  ["重要决策", "数据库选型最终定为 pgvector + PostgreSQL 17。"],
  ["关系与人物", "小李是用户的助理，负责整理项目资料。"],
  ["重要事件", "去年用户完成了一个省级重点工程的结算审计。"],
  ["知识收藏", "收藏一篇讲 memory decay 的论文，后面写方案要用。"],
  ["AI助手设置", "让助手回复时使用简体中文，不要用表情符号。"],
];

const USER_IDS = ["hermes-user-1", "hermes-user-2", "hermes-user-3"];
const AGENT_IDS = ["openclaw-main", "hermes-agent"];
const RUN_IDS = ["run-2026-11-a", "run-2026-11-b", "run-2026-10-c"];

// ---------------------------------------------------------------- review helpers
// Mirrors server/review.py: review fields live in the memory metadata, and a memory
// without review_status is pending.
const REVIEW_METADATA_KEYS = ["review_status", "reviewed_by", "reviewed_at", "review_note"];

function stripReviewMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") return metadata;
  const clean = { ...metadata };
  for (const key of REVIEW_METADATA_KEYS) delete clean[key];
  return clean;
}

/** Demo distribution: 25% pending, 50% approved, 25% rejected. */
function reviewFields(index) {
  if (index % 4 === 0) return {};
  if (index % 4 === 3) {
    return {
      review_status: "rejected",
      reviewed_by: "admin@example.com",
      reviewed_at: daysAgo(2),
      review_note: "内容太琐碎，暂不保留。",
    };
  }
  return {
    review_status: "approved",
    reviewed_by: "admin@example.com",
    reviewed_at: daysAgo(1),
    review_note: null,
  };
}

function seedMemories() {
  const rows = [];
  const count = EMPTY ? 0 : 40;
  for (let index = 0; index < count; index += 1) {
    const [category, text] = MEMORY_TEXTS[index % MEMORY_TEXTS.length];
    const createdAt = daysAgo((index % 28) + 1);
    const userId = USER_IDS[index % USER_IDS.length];
    rows.push({
      id: uid(),
      memory: text,
      user_id: userId,
      agent_id: index % 3 === 0 ? AGENT_IDS[index % AGENT_IDS.length] : null,
      run_id: index % 4 === 0 ? RUN_IDS[index % RUN_IDS.length] : null,
      hash: `hash-${index}`,
      expiration_date:
        index % 7 === 0
          ? new Date(Date.now() + (7 + index) * 86_400_000)
              .toISOString()
              .slice(0, 10)
          : null,
      categories: index % 9 === 0 ? [] : [category],
      metadata: {
        source: index % 2 === 0 ? "openclaw" : "mem0-sdk",
        confidence: Number((0.6 + (index % 4) * 0.1).toFixed(2)),
        ...reviewFields(index),
      },
      created_at: createdAt,
      updated_at: daysAgo(index % 20),
      _history: [
        {
          id: uid(),
          event: "ADD",
          old_memory: null,
          new_memory: text,
          created_at: createdAt,
        },
      ],
    });
  }
  return rows;
}

function seedRequests() {
  const rows = [];
  const methods = ["POST", "GET", "PUT", "DELETE"];
  const paths = ["/memories", "/search", "/memories/{id}", "/entities"];
  const authTypes = ["api_key", "jwt", "admin_api_key"];
  for (let index = 0; index < (EMPTY ? 0 : 120); index += 1) {
    rows.push({
      id: uid(),
      method: methods[index % methods.length],
      path: paths[index % paths.length],
      status_code: index % 17 === 0 ? 400 : 200,
      latency_ms: Number((8 + (index % 40) * 3.7).toFixed(2)),
      auth_type: authTypes[index % authTypes.length],
      created_at: new Date(Date.now() - index * 7 * 60_000).toISOString(),
    });
  }
  return rows;
}

function seedUsage() {
  const rows = [];
  const models = [
    { model_type: "llm", model_name: "gpt-4o-mini", base: 1800 },
    { model_type: "embedder", model_name: "text-embedding-3-small", base: 2600 },
    { model_type: "reranker", model_name: "cohere-rerank-3", base: 500 },
  ];
  for (let day = 29; day >= 0; day -= 1) {
    const date = new Date(Date.now() - day * 86_400_000)
      .toISOString()
      .slice(0, 10);
    for (const model of models) {
      const calls = 6 + ((day * 7 + model.base) % 23);
      const prompt = calls * (model.base + (day % 5) * 40);
      const completion = model.model_type === "llm" ? calls * 180 : 0;
      rows.push({
        key: date,
        model_type: model.model_type,
        model_name: model.model_name,
        calls,
        prompt_tokens: prompt,
        prompt_cached_tokens: Math.round(prompt * 0.12),
        completion_tokens: completion,
        total_tokens: prompt + completion,
      });
    }
  }
  return rows;
}

const DB = {
  users: USERS.map((user) => ({ ...user })),
  memories: seedMemories(),
  requests: seedRequests(),
  usage: seedUsage(),
  apiKeys: EMPTY
    ? []
    : [
        {
          id: uid(),
          label: "openclaw-nas",
          key: "mem0_sk_mock_nas_key_0001",
          key_prefix: "mem0_sk_mock",
          created_by: USERS[0].id,
          created_at: daysAgo(45),
          last_used_at: daysAgo(0),
          revoked_at: null,
        },
        {
          id: uid(),
          label: "hermes-local",
          key: "mem0_sk_mock_local_key_0002",
          key_prefix: "mem0_sk_mock",
          created_by: USERS[0].id,
          created_at: daysAgo(20),
          last_used_at: daysAgo(2),
          revoked_at: null,
        },
      ],
  config: {
    llm: {
      provider: "openai",
      config: {
        model: "gpt-4o-mini",
        temperature: 0.1,
        max_tokens: 2000,
        api_key: "sk-…（已隐藏）",
      },
    },
    embedder: {
      provider: "openai",
      config: { model: "text-embedding-3-small", api_key: "sk-…（已隐藏）" },
    },
    reranker: {
      provider: "cohere",
      config: { model: "rerank-v3.5", api_key: "co-…（已隐藏）" },
    },
    vector_store: {
      provider: "pgvector",
      config: { collection_name: "memories", embedding_model_dims: 1536 },
    },
    graph_store: { provider: "neo4j", config: { url: "bolt://neo4j:7687" } },
    custom_instructions:
      "优先记住用户的偏好、长期目标与项目背景；对一次性事务只保留结论。",
    custom_categories: catalogState.entries,
    custom_category_rules: catalogState.rules,
  },
  decayEnabled: true,
  defaultExpiryDays: 30,
};

function catalogPayload() {
  const entries = DB.config.custom_categories || [];
  const names = entries.map((entry) => entry.name);
  const disabled = entries
    .filter((entry) => entry.enabled === false)
    .map((entry) => entry.name);
  return {
    custom_categories: entries,
    custom_category_rules: DB.config.custom_category_rules || [],
    names,
    disabled,
    enabled_count: names.length - disabled.length,
  };
}

function serializedMemory(row) {
  return {
    id: row.id,
    memory: row.memory,
    user_id: row.user_id,
    agent_id: row.agent_id,
    run_id: row.run_id,
    hash: row.hash,
    expiration_date: row.expiration_date,
    categories: row.categories ?? [],
    metadata: row.metadata ?? {},
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function entityRows() {
  const buckets = new Map();
  const add = (type, id) => {
    const key = `${type}:${id}`;
    const existing = buckets.get(key);
    if (existing) existing.total_memories += 1;
    else
      buckets.set(key, {
        id,
        type,
        total_memories: 1,
        created_at: daysAgo(30),
        updated_at: daysAgo(1),
      });
  };
  for (const row of DB.memories) {
    if (row.user_id) add("user", row.user_id);
    if (row.agent_id) add("agent", row.agent_id);
    if (row.run_id) add("run", row.run_id);
  }
  return [...buckets.values()].sort((a, b) =>
    a.type === b.type ? a.id.localeCompare(b.id) : a.type.localeCompare(b.type),
  );
}

function matchesScope(user, row) {
  const scope = scopeOf(user);
  if (!scope) return true;
  return row.user_id === scope;
}

function classify(text) {
  for (const [category] of Object.entries(CATEGORY_SAMPLES)) {
    const words = category.replace(/[^\u4e00-\u9fa5]/g, "");
    if (text.includes(category)) return category;
    if (text.length > 3 && [...words].some((ch) => text.includes(ch))) {
      return category;
    }
  }
  return "个人信息";
}

function searchMemories(query, filters) {
  const normalized = String(query || "").toLowerCase();
  const scoped = DB.memories.filter((row) => {
    // 已驳回 = 软删除：控制台可见，但检索不召回。
    if (row.metadata?.review_status === "rejected") return false;
    if (!filters) return true;
    if (filters.user_id && row.user_id !== filters.user_id) return false;
    if (filters.agent_id && row.agent_id !== filters.agent_id) return false;
    if (filters.run_id && row.run_id !== filters.run_id) return false;
    return true;
  });
  const scored = scoped
    .map((row) => {
      const text = row.memory.toLowerCase();
      let score = 0;
      if (!normalized) score = 0.5;
      else if (text.includes(normalized)) score = 0.92;
      else {
        const chars = [...new Set(normalized)].filter((ch) => text.includes(ch));
        score = Math.min(0.85, chars.length / Math.max(4, normalized.length));
      }
      return { ...serializedMemory(row), score: Number(score.toFixed(3)) };
    })
    .filter((row) => row.score > 0.05)
    .sort((a, b) => b.score - a.score);
  return scored;
}

// --------------------------------------------------------------------- routes
const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const segments = pathname.split("/").filter(Boolean);
  const method = req.method || "GET";

  try {
    // ---- auth
    if (pathname === "/auth/setup-status" && method === "GET") {
      return send(res, 200, { needsSetup: DB.users.length === 0 });
    }

    if (pathname === "/auth/register" && method === "POST") {
      const body = await readJson(req);
      if (DB.users.length > 0) {
        return bad(res, 403, "Registration is closed. An admin account already exists.");
      }
      if (!body.email || String(body.password || "").length < 8) {
        return bad(res, 422, "Password must be at least 8 characters.");
      }
      const user = {
        id: uid(),
        name: body.name || "Admin",
        email: body.email,
        password: body.password,
        role: "admin",
        memory_scope: null,
        is_active: true,
        created_at: now(),
      };
      DB.users.push(user);
      const tokens = issueTokens(user);
      return send(res, 200, tokens, setRefreshCookie(tokens.refresh_token));
    }

    if (pathname === "/auth/login" && method === "POST") {
      const body = await readJson(req);
      const user = DB.users.find(
        (u) => u.email.toLowerCase() === String(body.email || "").toLowerCase(),
      );
      if (!user || user.password !== body.password) {
        return bad(res, 401, "Invalid email or password.");
      }
      if (user.is_active === false) {
        return bad(res, 401, "Invalid email or password.");
      }
      const tokens = issueTokens(user);
      return send(res, 200, tokens, setRefreshCookie(tokens.refresh_token));
    }

    if (pathname === "/auth/refresh" && method === "POST") {
      const body = await readJson(req).catch(() => ({}));
      const cookies = parseCookies(req);
      const token =
        body.refresh_token || cookies.mem0_console_rt || "";
      if (!String(token).startsWith(REFRESH_PREFIX)) {
        return bad(res, 401, "Refresh token is no longer valid.");
      }
      const userId = String(token).slice(REFRESH_PREFIX.length);
      const user = userById(userId);
      if (!user || user.is_active === false) {
        return bad(res, 401, "User not found.");
      }
      const tokens = issueTokens(user);
      return send(res, 200, tokens, setRefreshCookie(tokens.refresh_token));
    }

    if (pathname === "/auth/logout" && method === "POST") {
      return send(res, 200, { message: "Logged out." }, clearRefreshCookie());
    }

    if (pathname === "/auth/me" && method === "GET") {
      const user = requireAuth(req, res);
      if (!user) return;
      return send(res, 200, publicUser(user));
    }

    if (pathname === "/auth/me" && method === "PATCH") {
      const user = requireAuth(req, res);
      if (!user) return;
      const body = await readJson(req);
      if (body.name) user.name = body.name;
      if (body.email && body.email !== user.email) {
        if (DB.users.some((u) => u.id !== user.id && u.email === body.email)) {
          return bad(res, 409, "Email is already in use.");
        }
        user.email = body.email;
      }
      return send(res, 200, publicUser(user));
    }

    if (pathname === "/auth/change-password" && method === "POST") {
      const user = requireAuth(req, res);
      if (!user) return;
      const body = await readJson(req);
      if (body.current_password !== user.password) {
        return bad(res, 401, "Current password is incorrect.");
      }
      if (String(body.new_password || "").length < 8) {
        return bad(res, 422, "Password must be at least 8 characters.");
      }
      user.password = body.new_password;
      return send(res, 200, { message: "Password updated." });
    }

    if (pathname === "/auth/onboarding-complete" && method === "POST") {
      const user = requireAuth(req, res);
      if (!user) return;
      return send(res, 200, { message: "Onboarding completed." });
    }

    // ---- users (admin)
    if (segments[0] === "users") {
      const admin = requireAdmin(req, res);
      if (!admin) return;
      if (segments.length === 1 && method === "GET") {
        return send(res, 200, DB.users.map(publicUser));
      }
      if (segments.length === 1 && method === "POST") {
        const body = await readJson(req);
        if (!body.email || String(body.password || "").length < 8) {
          return bad(res, 422, "邮箱或密码不合法（密码至少 8 位）。");
        }
        if (DB.users.some((u) => u.email === body.email)) {
          return bad(res, 409, "Email is already in use.");
        }
        const user = {
          id: uid(),
          name: body.name || body.email.split("@")[0],
          email: body.email,
          password: body.password,
          role: body.role === "admin" ? "admin" : "user",
          memory_scope: body.memory_scope || null,
          is_active: true,
          created_at: now(),
        };
        DB.users.push(user);
        return send(res, 201, publicUser(user));
      }
      const target = userById(segments[1]);
      if (!target) return bad(res, 404, "User not found.");
      if (method === "PATCH") {
        const body = await readJson(req);
        const adminCount = DB.users.filter((u) => u.role === "admin" && u.is_active !== false).length;
        const losingAdmin =
          target.role === "admin" &&
          (body.role === "user" || body.is_active === false) &&
          adminCount <= 1;
        if (losingAdmin) return bad(res, 400, "不能停用或降级最后一个管理员。");
        if (body.name !== undefined) target.name = body.name;
        if (body.email !== undefined) target.email = body.email;
        if (body.role !== undefined) target.role = body.role;
        if (body.memory_scope !== undefined) target.memory_scope = body.memory_scope;
        if (body.is_active !== undefined) target.is_active = body.is_active;
        if (body.password) target.password = body.password;
        return send(res, 200, publicUser(target));
      }
      if (method === "DELETE") {
        if (target.id === admin.id) return bad(res, 400, "不能删除当前登录账号。");
        if (target.role === "admin" && DB.users.filter((u) => u.role === "admin").length <= 1) {
          return bad(res, 400, "不能删除最后一个管理员。");
        }
        DB.users = DB.users.filter((u) => u.id !== target.id);
        return send(res, 200, { message: "User deleted." });
      }
    }

    // ---- memories
    if (segments[0] === "memories") {
      const user = requireAuth(req, res);
      if (!user) return;
      const scope = scopeOf(user);

      if (segments.length === 1 && method === "GET") {
        const userId = url.searchParams.get("user_id");
        const agentId = url.searchParams.get("agent_id");
        const runId = url.searchParams.get("run_id");
        const topK = Number(url.searchParams.get("top_k") || 0);
        let rows = DB.memories;
        if (!userId && !agentId && !runId) {
          if (scope) return bad(res, 403, "Admin role required to list all memories.");
        } else {
          if (scope && userId !== scope) {
            return bad(res, 403, "Admin role required for this scope.");
          }
          rows = rows.filter(
            (row) =>
              (!userId || row.user_id === userId) &&
              (!agentId || row.agent_id === agentId) &&
              (!runId || row.run_id === runId),
          );
        }
        const results = rows
          .slice()
          .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
          .slice(0, topK > 0 ? topK : 1000)
          .map(serializedMemory);
        return send(res, 200, { results });
      }

      if (segments.length === 1 && method === "POST") {
        const body = await readJson(req);
        const messages = Array.isArray(body.messages) ? body.messages : [];
        const text = String(messages.map((m) => m.content).join("\n") || "").trim();
        if (!text) return bad(res, 422, "messages 不能为空");
        const scopedUserId = scope || body.user_id;
        if (!scopedUserId) {
          return bad(res, 400, "At least one identifier (user_id, agent_id, run_id) is required.");
        }
        const category = classify(text);
        const entry = {
          id: uid(),
          memory: text,
          user_id: scopedUserId,
          agent_id: body.agent_id || null,
          run_id: body.run_id || null,
          hash: `hash-${uid().slice(0, 8)}`,
          expiration_date:
            body.expiration_date ||
            (DB.defaultExpiryDays
              ? new Date(Date.now() + DB.defaultExpiryDays * 86_400_000)
                  .toISOString()
                  .slice(0, 10)
              : null),
          categories: body.categories || [category],
          metadata: stripReviewMetadata(body.metadata) || {},
          created_at: now(),
          updated_at: now(),
          _history: [],
        };
        entry._history.push({
          id: uid(),
          event: "ADD",
          old_memory: null,
          new_memory: text,
          created_at: entry.created_at,
        });
        DB.memories.unshift(entry);
        return send(res, 200, {
          results: [{ id: entry.id, memory: text, event: "ADD" }],
        });
      }

      if (segments.length === 2 && method === "GET") {
        const row = DB.memories.find((item) => item.id === segments[1]);
        if (!row || !matchesScope(user, row)) {
          return bad(res, 404, "Memory not found.");
        }
        return send(res, 200, serializedMemory(row));
      }

      if (segments.length === 2 && method === "PUT") {
        const row = DB.memories.find((item) => item.id === segments[1]);
        if (!row || !matchesScope(user, row)) {
          return bad(res, 404, "Memory not found.");
        }
        const body = await readJson(req);
        const old = row.memory;
        if (typeof body.text === "string" && body.text.trim()) {
          row.memory = body.text.trim();
          row.categories = [classify(row.memory)];
        }
        if (Array.isArray(body.categories)) {
          row.categories = body.categories;
        }
        if (body.expiration_date !== undefined) {
          row.expiration_date = body.expiration_date || null;
        }
        if (body.metadata && typeof body.metadata === "object") {
          row.metadata = { ...row.metadata, ...stripReviewMetadata(body.metadata) };
        }
        row.updated_at = now();
        row._history.push({
          id: uid(),
          event: "UPDATE",
          old_memory: old,
          new_memory: row.memory,
          created_at: row.updated_at,
        });
        return send(res, 200, { message: "Memory updated successfully!" });
      }

      if (segments.length === 2 && method === "DELETE") {
        const row = DB.memories.find((item) => item.id === segments[1]);
        if (!row || !matchesScope(user, row)) {
          return bad(res, 404, "Memory not found.");
        }
        DB.memories = DB.memories.filter((item) => item.id !== row.id);
        return send(res, 200, { message: "Memory deleted successfully" });
      }

      if (segments.length === 3 && segments[2] === "review" && method === "POST") {
        const admin = requireAdmin(req, res);
        if (!admin) return;
        const row = DB.memories.find((item) => item.id === segments[1]);
        if (!row) return bad(res, 404, "Memory not found.");
        const body = await readJson(req);
        if (body.action !== "approve" && body.action !== "reject") {
          return bad(res, 400, "action must be 'approve' or 'reject'.");
        }
        const note = typeof body.note === "string" ? body.note.trim() : "";
        if (note.length > 500) {
          return bad(res, 422, "note 最多 500 字。");
        }
        row.metadata = {
          ...(row.metadata || {}),
          review_status: body.action === "approve" ? "approved" : "rejected",
          reviewed_by: admin.email,
          reviewed_at: now(),
          review_note: note || null,
        };
        row.updated_at = now();
        row._history.push({
          id: uid(),
          event: "UPDATE",
          old_memory: row.memory,
          new_memory: row.memory,
          created_at: row.updated_at,
        });
        return send(res, 200, {
          message: body.action === "approve" ? "Memory approved." : "Memory rejected.",
        });
      }

      if (
        segments.length === 3 &&
        segments[2] === "history" &&
        method === "GET"
      ) {
        const row = DB.memories.find((item) => item.id === segments[1]);
        if (!row || !matchesScope(user, row)) {
          return bad(res, 404, "Memory not found.");
        }
        return send(res, 200, row._history ?? []);
      }

      if (segments.length === 1 && method === "DELETE") {
        const admin = requireAdmin(req, res);
        if (!admin) return;
        const userId = url.searchParams.get("user_id");
        const agentId = url.searchParams.get("agent_id");
        const runId = url.searchParams.get("run_id");
        if (!userId && !agentId && !runId) {
          return bad(res, 400, "At least one identifier is required.");
        }
        DB.memories = DB.memories.filter(
          (row) =>
            !(
              (userId && row.user_id === userId) &&
              (!agentId || row.agent_id === agentId) &&
              (!runId || row.run_id === runId)
            ),
        );
        return send(res, 200, { message: "All relevant memories deleted" });
      }
    }

    if (pathname === "/search" && method === "POST") {
      const user = requireAuth(req, res);
      if (!user) return;
      const body = await readJson(req);
      const filters = { ...(body.filters || {}) };
      const scope = scopeOf(user);
      if (scope) filters.user_id = scope;
      const results = searchMemories(body.query, filters).slice(
        0,
        Number(body.top_k || 10),
      );
      return send(res, 200, { results });
    }

    if (pathname === "/reset" && method === "POST") {
      const admin = requireAdmin(req, res);
      if (!admin) return;
      DB.memories = [];
      return send(res, 200, { message: "All memories reset" });
    }

    // ---- entities
    if (segments[0] === "entities") {
      const user = requireAuth(req, res);
      if (!user) return;
      const scope = scopeOf(user);
      if (segments.length === 1 && method === "GET") {
        const rows = entityRows().filter(
          (row) => !scope || (row.type === "user" && row.id === scope),
        );
        return send(res, 200, rows);
      }
      if (segments.length === 3 && method === "DELETE") {
        const admin = requireAdmin(req, res);
        if (!admin) return;
        const [type, id] = [segments[1], decodeURIComponent(segments[2])];
        const field = { user: "user_id", agent: "agent_id", run: "run_id" }[type];
        if (!field) return bad(res, 422, "Invalid entity type.");
        DB.memories = DB.memories.filter((row) => row[field] !== id);
        return send(res, 200, { message: "Entity deleted" });
      }
    }

    // ---- requests
    if (pathname === "/requests" && method === "GET") {
      const admin = requireAdmin(req, res);
      if (!admin) return;
      const limit = Math.min(200, Number(url.searchParams.get("limit") || 50));
      return send(res, 200, DB.requests.slice(0, limit));
    }

    // ---- usage
    if (pathname === "/usage/stats" && method === "GET") {
      const admin = requireAdmin(req, res);
      if (!admin) return;
      const groupBy = url.searchParams.get("group_by") || "day";
      const days = Number(url.searchParams.get("days") || 30);
      const modelType = url.searchParams.get("model_type");
      const since = Date.now() - days * 86_400_000;
      let rows = DB.usage.filter((row) => {
        const key = `${row.key}T00:00:00Z`;
        return new Date(key).getTime() >= since;
      });
      if (modelType) rows = rows.filter((row) => row.model_type === modelType);

      const totals = rows.reduce(
        (acc, row) => {
          acc.prompt_tokens += row.prompt_tokens;
          acc.prompt_cached_tokens += row.prompt_cached_tokens;
          acc.completion_tokens += row.completion_tokens;
          acc.total_tokens += row.total_tokens;
          acc.calls += row.calls;
          return acc;
        },
        {
          prompt_tokens: 0,
          prompt_cached_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          calls: 0,
        },
      );
      const byModelMap = new Map();
      for (const row of rows) {
        const mapKey = `${row.model_type}:${row.model_name}`;
        const existing = byModelMap.get(mapKey) || {
          model_type: row.model_type,
          model_name: row.model_name,
          calls: 0,
          prompt_tokens: 0,
          prompt_cached_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        };
        existing.calls += row.calls;
        existing.prompt_tokens += row.prompt_tokens;
        existing.prompt_cached_tokens += row.prompt_cached_tokens;
        existing.completion_tokens += row.completion_tokens;
        existing.total_tokens += row.total_tokens;
        byModelMap.set(mapKey, existing);
      }
      let outRows = rows;
      if (groupBy !== "day") {
        const grouped = new Map();
        for (const row of rows) {
          const key =
            groupBy === "month"
              ? row.key.slice(0, 7)
              : groupBy === "model"
                ? row.model_type
                : groupBy === "operation"
                  ? "add"
                  : row.model_name;
          const mapKey = `${key}:${row.model_type}`;
          const existing = grouped.get(mapKey) || {
            key,
            model_type: row.model_type,
            prompt_tokens: 0,
            prompt_cached_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
            calls: 0,
          };
          existing.prompt_tokens += row.prompt_tokens;
          existing.prompt_cached_tokens += row.prompt_cached_tokens;
          existing.completion_tokens += row.completion_tokens;
          existing.total_tokens += row.total_tokens;
          existing.calls += row.calls;
          grouped.set(mapKey, existing);
        }
        outRows = [...grouped.values()].sort((a, b) =>
          String(a.key).localeCompare(String(b.key)),
        );
      }
      return send(res, 200, {
        group_by: groupBy,
        days,
        rows: outRows,
        totals,
        by_model: [...byModelMap.values()],
      });
    }

    // ---- api keys
    if (segments[0] === "api-keys") {
      const user = requireAuth(req, res);
      if (!user) return;
      if (segments.length === 1 && method === "GET") {
        return send(
          res,
          200,
          DB.apiKeys
            .filter((key) => key.created_by === user.id && !key.revoked_at)
            .map((key) => ({
              id: key.id,
              label: key.label,
              key_prefix: key.key_prefix,
              created_at: key.created_at,
              last_used_at: key.last_used_at,
            })),
        );
      }
      if (segments.length === 1 && method === "POST") {
        const body = await readJson(req);
        const key = {
          id: uid(),
          label: String(body.label || "").trim() || "default",
          key: `mem0_sk_mock_${uid().replace(/-/g, "").slice(0, 24)}`,
          key_prefix: "mem0_sk_mock",
          created_by: user.id,
          created_at: now(),
          last_used_at: null,
          revoked_at: null,
        };
        DB.apiKeys.unshift(key);
        return send(res, 201, {
          id: key.id,
          key: key.key,
          label: key.label,
          key_prefix: key.key_prefix,
          created_at: key.created_at,
        });
      }
      if (segments.length === 2 && method === "DELETE") {
        const key = DB.apiKeys.find((item) => item.id === segments[1]);
        if (!key || key.created_by !== user.id) {
          return bad(res, 404, "API key not found.");
        }
        if (key.revoked_at) return bad(res, 400, "API key is already revoked.");
        key.revoked_at = now();
        return send(res, 200, { message: "API key revoked." });
      }
    }

    // ---- configuration
    if (pathname === "/configure" && method === "GET") {
      const user = requireAuth(req, res);
      if (!user) return;
      return send(res, 200, DB.config);
    }
    if (pathname === "/configure" && method === "POST") {
      const admin = requireAdmin(req, res);
      if (!admin) return;
      const body = await readJson(req);
      for (const [section, value] of Object.entries(body)) {
        if (section === "custom_instructions") {
          DB.config.custom_instructions = value;
          continue;
        }
        if (value && typeof value === "object" && !Array.isArray(value)) {
          DB.config[section] = deepMerge(DB.config[section], value);
        } else {
          DB.config[section] = value;
        }
      }
      return send(res, 200, { message: "Configuration set successfully" });
    }
    if (pathname === "/configure/providers" && method === "GET") {
      const user = requireAuth(req, res);
      if (!user) return;
      return send(res, 200, {
        llm: ["openai", "opencode", "anthropic", "gemini"],
        embedder: ["openai", "ollama", "huggingface", "azure_openai"],
      });
    }
    if (pathname === "/configure/test" && method === "POST") {
      const admin = requireAdmin(req, res);
      if (!admin) return;
      const body = await readJson(req);
      const target = String(body.target || "llm");
      const section = DB.config[target] || {};
      return send(res, 200, {
        target,
        provider: section.provider || "unconfigured",
        model: section.config?.model || "",
        ok: true,
        latency_ms: 120 + Math.round(Math.random() * 200),
        detail:
          target === "embedder"
            ? "返回向量维度 1536"
            : target === "reranker"
              ? "返回 2 条，首位得分 0.87"
              : "模型回复：pong",
        error: null,
      });
    }

    // ---- decay / expiry
    if (pathname === "/decay" && method === "GET") {
      const user = requireAuth(req, res);
      if (!user) return;
      return send(res, 200, { enabled: DB.decayEnabled });
    }
    if (pathname === "/decay" && method === "POST") {
      const admin = requireAdmin(req, res);
      if (!admin) return;
      const body = await readJson(req);
      DB.decayEnabled = Boolean(body.enabled);
      return send(res, 200, { enabled: DB.decayEnabled });
    }
    if (pathname === "/expiry-default" && method === "GET") {
      const user = requireAuth(req, res);
      if (!user) return;
      return send(res, 200, { days: DB.defaultExpiryDays });
    }
    if (pathname === "/expiry-default" && method === "POST") {
      const admin = requireAdmin(req, res);
      if (!admin) return;
      const body = await readJson(req);
      DB.defaultExpiryDays = body.days ?? null;
      return send(res, 200, { days: DB.defaultExpiryDays });
    }

    // ---- categories
    if (pathname === "/categories" && method === "GET") {
      const user = requireAuth(req, res);
      if (!user) return;
      return send(res, 200, catalogPayload());
    }
    if (pathname === "/categories" && method === "POST") {
      const admin = requireAdmin(req, res);
      if (!admin) return;
      const body = await readJson(req);
      if (Array.isArray(body.custom_categories)) {
        DB.config.custom_categories = body.custom_categories.map((entry) => {
          if (typeof entry === "string") return { name: entry, description: "", enabled: true };
          return {
            name: entry.name,
            description: entry.description || "",
            enabled: entry.enabled !== false,
          };
        });
      }
      if (Array.isArray(body.custom_category_rules)) {
        DB.config.custom_category_rules = body.custom_category_rules;
      }
      return send(res, 200, catalogPayload());
    }
    if (pathname === "/categories/test" && method === "POST") {
      const admin = requireAdmin(req, res);
      if (!admin) return;
      const body = await readJson(req);
      const text = String(body.text || "");
      const matched = classify(text);
      const candidates = [
        { name: matched, confidence: 0.82, reason: "关键词与分类描述匹配" },
        { name: "个人偏好", confidence: 0.31, reason: "语气带有偏好倾向" },
        { name: "短期任务", confidence: 0.12, reason: "存在时间限定词" },
      ].filter((candidate) => candidate.name !== matched);
      return send(res, 200, {
        candidates: [
          { name: matched, confidence: 0.82, reason: "关键词与分类描述匹配" },
          ...candidates,
        ],
        top: matched,
        conflict: false,
        error: null,
        catalog_size: (DB.config.custom_categories || []).length,
      });
    }

    // ---- misc
    if (pathname === "/generate-instructions" && method === "POST") {
      const user = requireAuth(req, res);
      if (!user) return;
      const body = await readJson(req);
      return send(res, 200, {
        custom_instructions: `针对「${body.use_case || "通用场景"}」：优先记住用户的稳定偏好、长期目标与项目背景；一次性事务只保留结论。`,
        test_message: "我喜欢在周末徒步，帮我记住。",
      });
    }

    if (pathname === "/api/health" || pathname === "/health") {
      return send(res, 200, { status: "ok" });
    }

    return bad(res, 404, `No mock route for ${method} ${pathname}`);
  } catch (error) {
    console.error("mock error", error);
    return bad(res, 500, "Mock server error");
  }
});

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    memory_scope: user.memory_scope ?? null,
    is_active: user.is_active !== false,
    created_at: user.created_at,
  };
}

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `[mock] Mem0 API on http://127.0.0.1:${PORT}` +
      (EMPTY ? "  (empty: setup wizard enabled)" : ""),
  );
  console.log("[mock] 账号: admin@example.com / admin12345678 (管理员)");
  console.log("[mock] 账号: user@example.com  / user12345678  (普通用户, scope=hermes-user-2)");
});
