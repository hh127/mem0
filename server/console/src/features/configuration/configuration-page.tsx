import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Link2, Sparkles, Tag, TimerReset } from "lucide-react";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/utils";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Field,
  Input,
  Textarea,
  buttonClass,
} from "@/ui/primitives";
import { ErrorState, PageHeader } from "@/ui/feedback";
import { Spinner } from "@/ui/spinner";
import { useToast } from "@/ui/toast";
import { ModelSectionCard } from "./model-section-card";
import {
  asText,
  isRecord,
} from "./types";
import type {
  ConfigureTestResult,
  Mem0Config,
  ModelSection,
  ProviderCatalog,
  SectionDraft,
  SectionKey,
  SectionPatch,
  TestState,
  TestTarget,
} from "./types";

const SECTION_KEYS: SectionKey[] = ["llm", "embedder", "reranker", "vector_store"];

const SECTION_META: Record<
  SectionKey,
  {
    title: string;
    description: string;
    target: TestTarget | null;
    providerSource: "llm" | "embedder" | null;
  }
> = {
  llm: {
    title: "大语言模型（LLM）",
    description: "记忆抽取、分类与指令生成使用的主模型。",
    target: "llm",
    providerSource: "llm",
  },
  embedder: {
    title: "嵌入模型（Embedder）",
    description: "把记忆编码为向量；更换模型可能改变向量维度，需要重建索引。",
    target: "embedder",
    providerSource: "embedder",
  },
  reranker: {
    title: "重排模型（Reranker）",
    description: "可选。对检索结果再做一次相关性排序，不配置则跳过重排。",
    target: "reranker",
    providerSource: null,
  },
  vector_store: {
    title: "向量库（Vector Store）",
    description: "存储向量与 payload 的后端。模型与采样参数对向量库不生效。",
    target: null,
    providerSource: null,
  },
};

const EMPTY_DRAFT: SectionDraft = {
  provider: "",
  model: "",
  baseUrl: "",
  apiKey: "",
  temperature: "",
  maxTokens: "",
};

function sectionToDraft(section: ModelSection | undefined): SectionDraft {
  const config = isRecord(section?.config) ? section.config : {};
  return {
    provider: typeof section?.provider === "string" ? section.provider : "",
    model: asText(config.model),
    baseUrl: asText(config.base_url),
    apiKey: "",
    temperature: asText(config.temperature),
    maxTokens: asText(config.max_tokens),
  };
}

function buildAllDrafts(config: Mem0Config | undefined): Record<SectionKey, SectionDraft> {
  return {
    llm: config?.llm ? sectionToDraft(config.llm) : { ...EMPTY_DRAFT },
    embedder: config?.embedder ? sectionToDraft(config.embedder) : { ...EMPTY_DRAFT },
    reranker: config?.reranker ? sectionToDraft(config.reranker) : { ...EMPTY_DRAFT },
    vector_store: config?.vector_store ? sectionToDraft(config.vector_store) : { ...EMPTY_DRAFT },
  };
}

function buildSectionPatch(
  section: ModelSection | undefined,
  draft: SectionDraft,
): SectionPatch | null {
  const originalConfig = isRecord(section?.config) ? section.config : {};
  const patch: SectionPatch = {};

  const provider = draft.provider.trim();
  const originalProvider = typeof section?.provider === "string" ? section.provider : "";
  if (provider && provider !== originalProvider) patch.provider = provider;

  const config: Record<string, unknown> = {};
  const model = draft.model.trim();
  if (model && model !== asText(originalConfig.model)) config.model = model;

  const baseUrl = draft.baseUrl.trim();
  if (baseUrl !== asText(originalConfig.base_url)) config.base_url = baseUrl;

  // 密钥留空表示不修改：绝不提交服务端回显的掩码值。
  const apiKey = draft.apiKey.trim();
  if (apiKey) config.api_key = apiKey;

  const temperature = draft.temperature.trim();
  if (temperature && temperature !== asText(originalConfig.temperature)) {
    config.temperature = Number(temperature);
  }

  const maxTokens = draft.maxTokens.trim();
  if (maxTokens && maxTokens !== asText(originalConfig.max_tokens)) {
    config.max_tokens = Number(maxTokens);
  }

  if (Object.keys(config).length > 0) patch.config = config;
  if (patch.provider === undefined && patch.config === undefined) return null;
  return patch;
}

function buildTestPayload(target: TestTarget, draft: SectionDraft) {
  const config: Record<string, unknown> = {};
  if (draft.model.trim()) config.model = draft.model.trim();
  if (draft.baseUrl.trim()) config.base_url = draft.baseUrl.trim();
  if (draft.apiKey.trim()) config.api_key = draft.apiKey.trim();
  if (target === "llm") {
    if (draft.temperature.trim()) config.temperature = Number(draft.temperature);
    if (draft.maxTokens.trim()) config.max_tokens = Number(draft.maxTokens);
  }
  return {
    target,
    config: {
      ...(draft.provider.trim() ? { provider: draft.provider.trim() } : {}),
      config,
    },
  };
}

function providerOptionsFor(
  key: SectionKey,
  providers: ProviderCatalog | undefined,
  current: string,
): string[] | null {
  const source = SECTION_META[key].providerSource;
  if (!source) return null;
  const list = providers?.[source] ?? [];
  if (list.length === 0) return current ? [current] : [];
  return current && !list.includes(current) ? [current, ...list] : list;
}

export function ConfigurationPage() {
  const { success, error: toastError, toast } = useToast();
  const queryClient = useQueryClient();

  const configQuery = useQuery({
    queryKey: ["configure"],
    queryFn: () => api.get<Mem0Config>("/configure"),
  });
  const providersQuery = useQuery({
    queryKey: ["configure", "providers"],
    queryFn: () => api.get<ProviderCatalog>("/configure/providers"),
  });
  const decayQuery = useQuery({
    queryKey: ["decay"],
    queryFn: () => api.get<{ enabled: boolean }>("/decay"),
  });
  const expiryQuery = useQuery({
    queryKey: ["expiry-default"],
    queryFn: () => api.get<{ days: number | null }>("/expiry-default"),
  });

  const [drafts, setDrafts] = useState<Record<SectionKey, SectionDraft>>(() =>
    buildAllDrafts(undefined),
  );
  const [instructions, setInstructions] = useState("");
  const [useCase, setUseCase] = useState("");
  const [generatedTestMessage, setGeneratedTestMessage] = useState<string | null>(null);
  const [testStates, setTestStates] = useState<Partial<Record<TestTarget, TestState>>>({});
  const [expiryDraft, setExpiryDraft] = useState("");

  useEffect(() => {
    if (!configQuery.data) return;
    setDrafts(buildAllDrafts(configQuery.data));
    setInstructions(configQuery.data.custom_instructions ?? "");
  }, [configQuery.data]);

  useEffect(() => {
    if (!expiryQuery.data) return;
    setExpiryDraft(
      expiryQuery.data.days === null || expiryQuery.data.days === undefined
        ? ""
        : String(expiryQuery.data.days),
    );
  }, [expiryQuery.data]);

  const patches = useMemo(() => {
    const result: Partial<Record<SectionKey, SectionPatch>> = {};
    for (const key of SECTION_KEYS) {
      const section = configQuery.data?.[key];
      const patch = buildSectionPatch(section, drafts[key]);
      if (patch) result[key] = patch;
    }
    return result;
  }, [configQuery.data, drafts]);

  const instructionsChanged =
    instructions !== (configQuery.data?.custom_instructions ?? "");
  const dirty = Object.keys(patches).length > 0 || instructionsChanged;

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post<{ message: string }>("/configure", payload),
    onSuccess: async () => {
      success("配置已保存");
      await configQuery.refetch();
    },
    onError: (err) => toastError(errorMessage(err, "保存配置失败")),
  });

  const handleSave = () => {
    const payload: Record<string, unknown> = {};
    for (const key of SECTION_KEYS) {
      const patch = patches[key];
      if (patch) payload[key] = patch;
    }
    if (instructionsChanged) payload.custom_instructions = instructions;
    if (Object.keys(payload).length === 0) {
      toast("没有需要保存的修改", "info");
      return;
    }
    saveMutation.mutate(payload);
  };

  const updateDraft = (key: SectionKey, patch: Partial<SectionDraft>) => {
    setDrafts((current) => ({
      ...current,
      [key]: { ...current[key], ...patch },
    }));
  };

  const runTest = async (target: TestTarget) => {
    setTestStates((current) => ({
      ...current,
      [target]: { loading: true, result: null, error: null },
    }));
    try {
      const result = await api.post<ConfigureTestResult>(
        "/configure/test",
        buildTestPayload(target, drafts[target]),
      );
      setTestStates((current) => ({
        ...current,
        [target]: { loading: false, result, error: null },
      }));
      if (result.ok) {
        success(`${SECTION_META[target].title} 连接正常（${result.latency_ms} ms）`);
      } else {
        toastError(result.error ?? `${SECTION_META[target].title} 连接失败`);
      }
    } catch (err) {
      const message = errorMessage(err, "连接测试失败");
      setTestStates((current) => ({
        ...current,
        [target]: { loading: false, result: null, error: message },
      }));
      toastError(message);
    }
  };

  const decayMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      api.post<{ enabled: boolean }>("/decay", { enabled }),
    onSuccess: (result) => {
      queryClient.setQueryData(["decay"], result);
      success(result.enabled ? "已开启记忆衰减" : "已关闭记忆衰减");
    },
    onError: (err) => toastError(errorMessage(err, "更新记忆衰减失败")),
  });

  const expiryMutation = useMutation({
    mutationFn: (days: number | null) =>
      api.post<{ days: number | null }>("/expiry-default", { days }),
    onSuccess: (result) => {
      queryClient.setQueryData(["expiry-default"], result);
      setExpiryDraft(
        result.days === null || result.days === undefined ? "" : String(result.days),
      );
      success(
        result.days === null || result.days === undefined
          ? "已设为永不过期"
          : `默认到期天数已设为 ${result.days} 天`,
      );
    },
    onError: (err) => toastError(errorMessage(err, "保存默认到期天数失败")),
  });

  const handleExpirySave = () => {
    const trimmed = expiryDraft.trim();
    if (!trimmed) {
      expiryMutation.mutate(null);
      return;
    }
    const value = Number(trimmed);
    if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
      toastError("到期天数必须是正整数，留空表示永不过期");
      return;
    }
    expiryMutation.mutate(value);
  };

  const generateMutation = useMutation({
    mutationFn: (value: string) =>
      api.post<{ custom_instructions: string; test_message: string }>(
        "/generate-instructions",
        { use_case: value },
      ),
    onSuccess: (result) => {
      setInstructions(result.custom_instructions);
      setGeneratedTestMessage(result.test_message);
      success("已生成自定义指令草稿");
    },
    onError: (err) => toastError(errorMessage(err, "生成指令失败")),
  });

  const decayEnabled = decayQuery.data?.enabled ?? false;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="管理"
        title="运行时配置"
        description="覆盖 LLM、嵌入、重排与向量库配置，并做真实连通性测试。保存只提交改动过的区块，未填写的密钥保持不变。"
        actions={
          <>
            <Link to="/categories/manage" className={buttonClass("secondary", "md")}>
              <Tag className="size-4" />
              分类管理
            </Link>
            <Button
              variant="primary"
              onClick={handleSave}
              loading={saveMutation.isPending}
              disabled={!dirty}
            >
              保存配置
            </Button>
          </>
        }
      />

      {configQuery.isError ? (
        <ErrorState
          message={errorMessage(configQuery.error, "无法读取当前配置")}
          onRetry={() => void configQuery.refetch()}
        />
      ) : configQuery.isLoading ? (
        <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-line bg-panel px-4 py-10 text-sm text-ink-soft">
          <Spinner className="size-4 text-accent" />
          正在加载运行时配置…
        </div>
      ) : (
        <>
          {dirty ? (
            <p className="inline-flex items-center gap-2 rounded-full border border-warn/30 bg-warn-soft px-3 py-1 text-xs text-warn">
              有未保存的修改
            </p>
          ) : null}

          <div className="space-y-3">
            {SECTION_KEYS.map((key) => {
              const meta = SECTION_META[key];
              return (
                <ModelSectionCard
                  key={key}
                  idPrefix={`config-${key}`}
                  title={meta.title}
                  description={meta.description}
                  draft={drafts[key]}
                  providerOptions={providerOptionsFor(
                    key,
                    providersQuery.data,
                    drafts[key].provider,
                  )}
                  apiKeyConfigured={Boolean(
                    isRecord(configQuery.data?.[key]?.config) &&
                      configQuery.data?.[key]?.config?.api_key,
                  )}
                  changed={Boolean(patches[key])}
                  testState={meta.target ? testStates[meta.target] : undefined}
                  supportsTest={meta.target !== null}
                  onProviderChange={(value) =>
                    updateDraft(key, { provider: value })
                  }
                  onChange={(patch) => updateDraft(key, patch)}
                  onTest={() => {
                    if (meta.target) void runTest(meta.target);
                  }}
                />
              );
            })}
          </div>

          <Card className="space-y-4 p-4">
            <div className="border-b border-line pb-3">
              <p className="text-sm font-medium text-ink">自定义指令</p>
              <p className="text-xs leading-5 text-ink-faint">
                注入记忆抽取的系统提示词，用于限定记什么、不记什么。修改后随整页「保存配置」提交。
              </p>
            </div>

            <Textarea
              value={instructions}
              className="min-h-28 text-xs leading-6"
              placeholder="例如：优先记住用户的偏好、长期目标与项目背景；一次性事务只保留结论。"
              onChange={(event) => setInstructions(event.target.value)}
            />

            <div className="flex flex-col gap-2 rounded-lg border border-line bg-panel-2/40 p-3 md:flex-row md:items-end">
              <Field
                label="按使用场景生成草稿"
                htmlFor="config-use-case"
                hint="描述你的使用场景，由当前 LLM 生成一段指令草稿"
                className="flex-1"
              >
                <Input
                  id="config-use-case"
                  value={useCase}
                  placeholder="例如：个人知识管理助手，需要长期记住用户偏好与项目背景"
                  onChange={(event) => setUseCase(event.target.value)}
                />
              </Field>
              <Button
                variant="secondary"
                onClick={() => {
                  if (useCase.trim()) generateMutation.mutate(useCase.trim());
                }}
                loading={generateMutation.isPending}
                disabled={!useCase.trim()}
              >
                <Sparkles className="size-4" />
                生成草稿
              </Button>
            </div>

            {generatedTestMessage ? (
              <p className="rounded-lg border border-line bg-panel-2/40 px-3 py-2 text-xs leading-5 text-ink-soft">
                建议测试消息：{generatedTestMessage}
              </p>
            ) : null}
          </Card>

          <div className="grid gap-3 md:grid-cols-2">
            <Card className="space-y-3 p-4">
              <div className="flex items-start gap-2">
                <TimerReset className="mt-0.5 size-4 shrink-0 text-ink-faint" />
                <div>
                  <p className="text-sm font-medium text-ink">记忆衰减</p>
                  <p className="text-xs leading-5 text-ink-faint">
                    开启后，搜索会对较早的记忆施加时间衰减，越新的记忆权重越高。
                  </p>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-ink">
                <Checkbox
                  checked={decayEnabled}
                  disabled={decayQuery.isLoading || decayMutation.isPending}
                  onChange={(event) => decayMutation.mutate(event.target.checked)}
                />
                <span>{decayEnabled ? "已开启" : "已关闭"}</span>
                {decayMutation.isPending ? (
                  <Spinner className="size-3.5 text-ink-faint" />
                ) : null}
              </label>
              {decayQuery.isError ? (
                <p className="text-xs text-danger">
                  {errorMessage(decayQuery.error, "读取衰减状态失败")}
                </p>
              ) : null}
            </Card>

            <Card className="space-y-3 p-4">
              <div className="flex items-start gap-2">
                <CalendarClock className="mt-0.5 size-4 shrink-0 text-ink-faint" />
                <div>
                  <p className="text-sm font-medium text-ink">默认到期天数</p>
                  <p className="text-xs leading-5 text-ink-faint">
                    新记忆在未显式指定到期时间时使用该值。留空表示永不过期。
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <Field label="天数" htmlFor="config-expiry-days" className="w-32">
                  <Input
                    id="config-expiry-days"
                    inputMode="numeric"
                    value={expiryDraft}
                    placeholder="留空 = 永不过期"
                    onChange={(event) => setExpiryDraft(event.target.value)}
                  />
                </Field>
                <Button
                  variant="secondary"
                  onClick={handleExpirySave}
                  loading={expiryMutation.isPending}
                >
                  保存天数
                </Button>
              </div>
              {expiryQuery.isError ? (
                <p className="text-xs text-danger">
                  {errorMessage(expiryQuery.error, "读取默认到期天数失败")}
                </p>
              ) : null}
            </Card>
          </div>

          <Card className="flex flex-wrap items-center justify-between gap-2 p-4">
            <div className="flex items-center gap-2">
              <Link2 className="size-4 text-ink-faint" />
              <p className="text-sm text-ink">
                分类目录：共{" "}
                <span className="font-medium">
                  {configQuery.data?.custom_categories?.length ?? 0}
                </span>{" "}
                个分类
                {configQuery.data?.custom_category_rules?.length
                  ? ` · ${configQuery.data.custom_category_rules.length} 条判定规则`
                  : ""}
              </p>
              <Badge tone="neutral">在分类管理中编辑</Badge>
            </div>
            <Link to="/categories/manage" className={buttonClass("secondary", "sm")}>
              打开分类管理
            </Link>
          </Card>
        </>
      )}
    </div>
  );
}
