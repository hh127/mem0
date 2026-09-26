"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import { UpgradeBanner } from "@/components/self-hosted/upgrade-banner";
import { getErrorMessage } from "@/lib/error-message";
import { api } from "@/utils/api";
import { MEMORY_ENDPOINTS } from "@/utils/api-endpoints";
import {
  RERANKER_PROVIDERS,
  buildEmbedderConfig,
  buildLlmConfig,
  buildRerankerConfig,
  getEffectiveConfig,
  parseOptionalNumber,
} from "@/utils/self-hosted-config";
import { useAuth } from "@/hooks/use-auth";
import { useApiQuery } from "@/hooks/use-api-query";

type BundledProviders = {
  llm: string[];
  embedder: string[];
};

export default function ConfigurationPage() {
  const { isAdmin } = useAuth();
  const [isSaving, setIsSaving] = useState(false);
  const [llmProvider, setLlmProvider] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmBaseUrl, setLlmBaseUrl] = useState("");
  const [llmTemperature, setLlmTemperature] = useState("");
  const [llmMaxTokens, setLlmMaxTokens] = useState("");
  const [embedderProvider, setEmbedderProvider] = useState("");
  const [embedderModel, setEmbedderModel] = useState("");
  const [embedderApiKey, setEmbedderApiKey] = useState("");
  const [embedderBaseUrl, setEmbedderBaseUrl] = useState("");
  const [rerankerProvider, setRerankerProvider] = useState("");
  const [rerankerModel, setRerankerModel] = useState("");
  const [rerankerApiKey, setRerankerApiKey] = useState("");
  const [rerankerBaseUrl, setRerankerBaseUrl] = useState("");
  const [rerankerTopK, setRerankerTopK] = useState("");

  const { data: config, isLoading: isPrefilling } = useApiQuery(
    async () => {
      const res = await api.get(MEMORY_ENDPOINTS.CONFIGURE);
      return getEffectiveConfig(res.data);
    },
    { errorToast: "服务器配置加载失败" },
  );

  const { data: providers } = useApiQuery<BundledProviders>(
    async () => {
      const res = await api.get<BundledProviders>(
        MEMORY_ENDPOINTS.CONFIGURE_PROVIDERS,
      );
      return res.data;
    },
    { errorToast: "内置提供商加载失败" },
  );

  useEffect(() => {
    if (!config) return;
    const llmConfig = config.llm?.config;
    const embedderConfig = config.embedder?.config;
    const rerankerConfig = config.reranker?.config;

    setLlmProvider((current) => current || config.llm?.provider || "");
    setLlmModel((current) => current || (llmConfig?.model as string) || "");
    setLlmBaseUrl(
      (current) => current || (llmConfig?.openai_base_url as string) || "",
    );
    setLlmTemperature((current) =>
      current ||
      (typeof llmConfig?.temperature === "number"
        ? String(llmConfig.temperature)
        : ""),
    );
    setLlmMaxTokens((current) =>
      current ||
      (typeof llmConfig?.max_tokens === "number"
        ? String(llmConfig.max_tokens)
        : ""),
    );

    setEmbedderProvider(
      (current) => current || config.embedder?.provider || "",
    );
    setEmbedderModel(
      (current) => current || (embedderConfig?.model as string) || "",
    );
    setEmbedderBaseUrl(
      (current) => current || (embedderConfig?.openai_base_url as string) || "",
    );

    setRerankerProvider(
      (current) => current || config.reranker?.provider || "",
    );
    setRerankerModel(
      (current) => current || (rerankerConfig?.model as string) || "",
    );
    setRerankerBaseUrl(
      (current) => current || (rerankerConfig?.base_url as string) || "",
    );
    setRerankerTopK((current) =>
      current ||
      (typeof rerankerConfig?.top_k === "number"
        ? String(rerankerConfig.top_k)
        : ""),
    );
  }, [config]);

  const handleSave = async () => {
    setIsSaving(true);

    try {
      const llm = buildLlmConfig({
        provider: llmProvider,
        model: llmModel,
        apiKey: llmApiKey,
        baseUrl: llmBaseUrl,
        temperature: parseOptionalNumber(llmTemperature),
        maxTokens: parseOptionalNumber(llmMaxTokens),
      });
      const embedder = buildEmbedderConfig({
        provider: embedderProvider,
        model: embedderModel,
        apiKey: embedderApiKey,
        baseUrl: embedderBaseUrl,
      });
      const reranker = buildRerankerConfig({
        provider: rerankerProvider,
        model: rerankerModel,
        apiKey: rerankerApiKey,
        baseUrl: rerankerBaseUrl,
        topK: parseOptionalNumber(rerankerTopK),
      });

      const newConfig: Record<string, unknown> = {
        version: "v1.1",
      };

      if (llm) {
        newConfig.llm = llm;
      }

      if (embedder) {
        newConfig.embedder = embedder;
      }

      if (reranker) {
        newConfig.reranker = reranker;
      }

      await api.post(MEMORY_ENDPOINTS.CONFIGURE, newConfig);
      toast({ title: "配置已保存", variant: "success" });
    } catch (error) {
      toast({
        title: "配置保存失败",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold font-fustat">配置</h1>
        {isPrefilling && (
          <p className="text-sm text-onSurface-default-tertiary">
            正在加载生效中的服务器配置…
          </p>
        )}
        <p className="text-xs text-onSurface-default-tertiary">
          保存后立即生效，无需重启，并写入服务器数据库（重启后依然保留）。留空的字段不会被修改。
        </p>
      </div>

      <Card className="border-memBorder-primary">
        <CardHeader>
          <CardTitle className="text-sm">LLM 提供商</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">提供商</Label>
              <Select
                value={llmProvider}
                onValueChange={(value) => {
                  setLlmProvider(value);
                  setLlmApiKey("");
                }}
                disabled={!isAdmin || !providers}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择提供商" />
                </SelectTrigger>
                <SelectContent>
                  {providers?.llm.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">模型</Label>
              <Input
                placeholder="gpt-4.1-nano-2025-04-14"
                value={llmModel}
                onChange={(e) => setLlmModel(e.target.value)}
                disabled={!isAdmin}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Base URL（兼容 OpenAI 协议的地址）</Label>
            <Input
              placeholder="https://api.deepseek.com/v1"
              value={llmBaseUrl}
              onChange={(e) => setLlmBaseUrl(e.target.value)}
              disabled={!isAdmin}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">API 密钥</Label>
            <Input
              type="password"
              placeholder="sk-...（留空 = 不修改）"
              value={llmApiKey}
              onChange={(e) => setLlmApiKey(e.target.value)}
              disabled={!isAdmin}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">随机性 temperature</Label>
              <Input
                type="number"
                step="0.1"
                min="0"
                max="2"
                placeholder="0.2"
                value={llmTemperature}
                onChange={(e) => setLlmTemperature(e.target.value)}
                disabled={!isAdmin}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">最大输出长度 max_tokens</Label>
              <Input
                type="number"
                step="1"
                min="1"
                placeholder="留空 = 用服务商默认"
                value={llmMaxTokens}
                onChange={(e) => setLlmMaxTokens(e.target.value)}
                disabled={!isAdmin}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-memBorder-primary">
        <CardHeader>
          <CardTitle className="text-sm">Embedding 模型</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">提供商</Label>
              <Select
                value={embedderProvider}
                onValueChange={setEmbedderProvider}
                disabled={!isAdmin || !providers}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择提供商" />
                </SelectTrigger>
                <SelectContent>
                  {providers?.embedder.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">模型</Label>
              <Input
                placeholder="text-embedding-3-small"
                value={embedderModel}
                onChange={(e) => setEmbedderModel(e.target.value)}
                disabled={!isAdmin}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Base URL（兼容 OpenAI 协议的地址）</Label>
            <Input
              placeholder="https://api.siliconflow.cn/v1"
              value={embedderBaseUrl}
              onChange={(e) => setEmbedderBaseUrl(e.target.value)}
              disabled={!isAdmin}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">API 密钥</Label>
            <Input
              type="password"
              placeholder="sk-...（留空 = 不修改）"
              value={embedderApiKey}
              onChange={(e) => setEmbedderApiKey(e.target.value)}
              disabled={!isAdmin}
            />
          </div>
          <p className="text-xs text-onSurface-default-tertiary">
            换嵌入模型 = 换向量维度，历史记忆的向量对不上会导致搜索失效（当前 pgvector 为
            1024 维）。只换 LLM 没有这个问题。
          </p>
        </CardContent>
      </Card>

      <Card className="border-memBorderPrimary">
        <CardHeader>
          <CardTitle className="text-sm">重排序模型（Reranker）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">提供商</Label>
              <Select
                value={rerankerProvider}
                onValueChange={setRerankerProvider}
                disabled={!isAdmin}
              >
                <SelectTrigger>
                  <SelectValue placeholder="cloud_reranker" />
                </SelectTrigger>
                <SelectContent>
                  {RERANKER_PROVIDERS.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">模型</Label>
              <Input
                placeholder="BAAI/bge-reranker-v2-m3"
                value={rerankerModel}
                onChange={(e) => setRerankerModel(e.target.value)}
                disabled={!isAdmin}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Base URL（/rerank 接口的地址）</Label>
            <Input
              placeholder="https://api.siliconflow.cn/v1"
              value={rerankerBaseUrl}
              onChange={(e) => setRerankerBaseUrl(e.target.value)}
              disabled={!isAdmin}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">API 密钥</Label>
            <Input
              type="password"
              placeholder="sk-...（留空 = 不修改）"
              value={rerankerApiKey}
              onChange={(e) => setRerankerApiKey(e.target.value)}
              disabled={!isAdmin}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">返回条数 top_k</Label>
            <Input
              type="number"
              step="1"
              min="1"
              placeholder="5"
              value={rerankerTopK}
              onChange={(e) => setRerankerTopK(e.target.value)}
              disabled={!isAdmin}
            />
          </div>
          <p className="text-xs text-onSurface-default-tertiary">
            重排序只在「搜索」时触发，写入记忆不会用到它。
          </p>
        </CardContent>
      </Card>

      <p className="text-xs text-onSurface-default-tertiary">
        Need another provider? Install its Python package, rebuild the image,
        and extend the bundled list. See the{" "}
        <a
          href="https://docs.mem0.ai/open-source/setup#supported-providers"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4 hover:text-onSurface-default-primary"
        >
          setup guide
        </a>
        .
      </p>

      {isAdmin && (
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Saving..." : "保存配置"}
        </Button>
      )}

      <UpgradeBanner
        id="config-sso"
        message="Looking for SSO / SAML? Available in Enterprise."
        ctaLabel="联系销售"
        ctaUrl="https://app.mem0.ai/enterprise?utm_source=oss&utm_medium=dashboard-configuration-sso"
        variant="enterprise"
      />
    </div>
  );
}
