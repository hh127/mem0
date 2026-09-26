"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy } from "lucide-react";
import { CopyToClipboard } from "react-copy-to-clipboard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { getErrorMessage } from "@/lib/error-message";
import { cn } from "@/lib/utils";
import { api } from "@/utils/api";
import {
  API_KEY_ENDPOINTS,
  AUTH_ENDPOINTS,
  MEMORY_ENDPOINTS,
} from "@/utils/api-endpoints";
import {
  buildProviderConfig,
  getEffectiveConfig,
} from "@/utils/self-hosted-config";
import { isValidEmail } from "@/lib/validators";

type BundledProviders = {
  llm: string[];
  embedder: string[];
};

const STEPS = [
  "管理员账户",
  "Providers",
  "API 密钥",
  "使用场景",
  "快速测试",
];
const STEP_TITLES = [
  "创建管理员账户",
  "检查提供商配置",
  "你的 API 密钥",
  "告诉我们你的使用场景",
  "测试你的配置",
];
const SUPPORTED_PROVIDERS_URL =
  "https://docs.mem0.ai/open-source/setup#supported-providers";

const USE_CASE_PRESETS = [
  "个人助理",
  "编程助手",
  "技术支持",
  "Research",
  "Therapy / journaling",
];

const DEFAULT_TEST_MESSAGE = "我周末喜欢去徒步。";

export default function SetupPage() {
  const router = useRouter();
  const { register } = useAuth();
  const [step, setStep] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isPrefillingConfig, setIsPrefillingConfig] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [llmProvider, setLlmProvider] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [embedderProvider, setEmbedderProvider] = useState("");
  const [embedderModel, setEmbedderModel] = useState("");
  const [serverHasLlmKey, setServerHasLlmKey] = useState(false);
  const [providers, setProviders] = useState<BundledProviders | null>(null);
  const [initialLlmProvider, setInitialLlmProvider] = useState("");
  const [initialLlmModel, setInitialLlmModel] = useState("");
  const [initialEmbedderProvider, setInitialEmbedderProvider] = useState("");
  const [initialEmbedderModel, setInitialEmbedderModel] = useState("");

  const [apiKey, setApiKey] = useState("");
  const [keyLabel, setKeyLabel] = useState("");
  const [copied, setCopied] = useState(false);
  const [testSuccess, setTestSuccess] = useState(false);

  const [useCase, setUseCase] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [testMessage, setTestMessage] = useState(DEFAULT_TEST_MESSAGE);
  const [isGeneratingInstructions, setIsGeneratingInstructions] =
    useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";

  useEffect(() => {
    if (step !== 1) {
      setIsPrefillingConfig(false);
      return;
    }

    let active = true;
    setIsPrefillingConfig(true);

    const loadConfig = async () => {
      try {
        const [configRes, providersRes] = await Promise.all([
          api.get(MEMORY_ENDPOINTS.CONFIGURE),
          api.get<BundledProviders>(MEMORY_ENDPOINTS.CONFIGURE_PROVIDERS),
        ]);
        const config = getEffectiveConfig(configRes.data);

        if (!active) {
          return;
        }

        const llmProv = config?.llm?.provider || "";
        const llmMod = config?.llm?.config?.model || "";
        const embProv = config?.embedder?.provider || "";
        const embMod = config?.embedder?.config?.model || "";

        setLlmProvider(llmProv);
        setLlmModel(llmMod);
        setEmbedderProvider(embProv);
        setEmbedderModel(embMod);
        setInitialLlmProvider(llmProv);
        setInitialLlmModel(llmMod);
        setInitialEmbedderProvider(embProv);
        setInitialEmbedderModel(embMod);
        setServerHasLlmKey(!!config?.llm?.config?.api_key);
        setProviders(providersRes.data);
      } catch (err) {
        if (active) {
          setError(getErrorMessage(err, "无法读取服务器配置"));
        }
      } finally {
        if (active) {
          setIsPrefillingConfig(false);
        }
      }
    };

    void loadConfig();

    return () => {
      active = false;
    };
  }, [step]);

  const handleStep1 = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isValidEmail(email)) {
      setError("请输入有效的邮箱地址。");
      return;
    }

    if (password !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }

    if (password.length < 8) {
      setError("密码至少需要 8 位");
      return;
    }

    setError("");
    setIsLoading(true);

    try {
      await register(name, email, password);
      setStep(1);
    } catch (err) {
      setError(getErrorMessage(err, "注册失败"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleStep2 = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const dirty =
      !!llmApiKey ||
      llmProvider !== initialLlmProvider ||
      llmModel !== initialLlmModel ||
      embedderProvider !== initialEmbedderProvider ||
      embedderModel !== initialEmbedderModel;

    if (!dirty) {
      setStep(2);
      return;
    }

    setIsLoading(true);
    try {
      const llm = buildProviderConfig({
        provider: llmProvider,
        model: llmModel,
        apiKey: llmApiKey,
      });
      const embedder = buildProviderConfig({
        provider: embedderProvider,
        model: embedderModel,
        apiKey:
          llmApiKey && embedderProvider === llmProvider ? llmApiKey : undefined,
      });

      const payload: Record<string, unknown> = { version: "v1.1" };
      if (llm) payload.llm = llm;
      if (embedder) payload.embedder = embedder;

      await api.post(MEMORY_ENDPOINTS.CONFIGURE, payload);
      if (llmApiKey) setServerHasLlmKey(true);
      setLlmApiKey("");
      setInitialLlmProvider(llmProvider);
      setInitialLlmModel(llmModel);
      setInitialEmbedderProvider(embedderProvider);
      setInitialEmbedderModel(embedderModel);
      setStep(2);
    } catch (err) {
      setError(getErrorMessage(err, "配置保存失败"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleStep3 = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const res = await api.post(API_KEY_ENDPOINTS.BASE, {
        label: keyLabel.trim() || "我的第一个密钥",
      });
      setApiKey(res.data.key);
    } catch (err) {
      setError(getErrorMessage(err, "API 密钥创建失败"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleContinueToUseCase = (e: React.FormEvent) => {
    e.preventDefault();
    setStep(3);
  };

  const handleContinueToQuickTest = () => {
    setError("");
    setStep(4);
  };

  const handleGoToDashboard = (e: React.FormEvent) => {
    e.preventDefault();
    router.push("/dashboard/requests");
  };

  const handleTest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const res = await fetch(`${apiUrl}/memories`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify({
          messages: [{ role: "user", content: testMessage }],
          user_id: "setup-test",
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        let detail = body;
        try {
          detail = JSON.parse(body).detail ?? body;
        } catch {}
        throw new Error(
          `Test failed (${res.status}): ${detail || res.statusText}`,
        );
      }

      setTestSuccess(true);
      void api
        .post(AUTH_ENDPOINTS.ONBOARDING_COMPLETE, { use_case: useCase })
        .catch(() => {});
    } catch (err) {
      setError(getErrorMessage(err, "测试失败"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-default-primary p-4">
      <div className="w-full max-w-[560px] space-y-6">
        <div className="flex items-center justify-center gap-2">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div
                className={cn(
                  "size-7 rounded-full flex items-center justify-center text-xs font-medium",
                  i <= step
                    ? "bg-memPurple-500 text-white"
                    : "bg-memNeutral-200 text-onSurface-default-tertiary",
                )}
              >
                {i < step ? <Check className="size-3.5" /> : i + 1}
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={cn(
                    "w-8 h-[2px]",
                    i < step ? "bg-memPurple-500" : "bg-memNeutral-200",
                  )}
                />
              )}
            </div>
          ))}
        </div>
        <p className="text-center text-sm text-onSurface-default-tertiary">
          {STEPS[step]}
        </p>

        <Card className="border-memBorder-primary">
          <CardContent className="p-6 space-y-4">
            <div className="space-y-1">
              <h2 className="text-base font-semibold font-fustat">
                {STEP_TITLES[step]}
              </h2>
              {isPrefillingConfig && step === 1 && (
                <p className="text-xs text-onSurface-default-tertiary">
                  正在检查服务器配置…
                </p>
              )}
            </div>
            {error && (
              <p className="text-sm text-onSurface-danger-primary">{error}</p>
            )}

            {step === 0 && (
              <form onSubmit={handleStep1} className="space-y-4">
                <div className="space-y-1">
                  <Label htmlFor="setup-name">名称</Label>
                  <Input
                    id="setup-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="你的名字"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="setup-email">邮箱</Label>
                  <Input
                    id="setup-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@company.com"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="setup-password">密码</Label>
                  <Input
                    id="setup-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="至少 8 位"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="setup-confirm-password">
                    确认密码
                  </Label>
                  <Input
                    id="setup-confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </div>
                <Button
                  type="submit"
                  disabled={isLoading || !name || !email || !password}
                  className="w-full"
                >
                  {isLoading ? "Creating..." : "创建管理员账户"}
                </Button>
              </form>
            )}

            {step === 1 && (
              <form onSubmit={handleStep2} className="space-y-4">
                {!serverHasLlmKey && (
                  <div className="rounded-md border border-memBorder-primary bg-surface-default-secondary p-3">
                    <p className="text-xs text-onSurface-default-tertiary">
                      No LLM provider API key is configured on the server. Paste
                      one below to continue — it will be saved to the server and
                      used for all memory operations.
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="setup-llm-provider">LLM 提供商</Label>
                    <Select
                      value={llmProvider}
                      onValueChange={(value) => {
                        setLlmProvider(value);
                        setLlmApiKey("");
                      }}
                      disabled={!providers}
                    >
                      <SelectTrigger id="setup-llm-provider">
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
                    <Label htmlFor="setup-llm-model">模型</Label>
                    <Input
                      id="setup-llm-model"
                      value={llmModel}
                      onChange={(e) => setLlmModel(e.target.value)}
                      placeholder="gpt-4.1-nano-2025-04-14"
                      className="font-mono text-sm"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="setup-llm-api-key">LLM API 密钥</Label>
                  <Input
                    id="setup-llm-api-key"
                    type="password"
                    value={llmApiKey}
                    onChange={(e) => setLlmApiKey(e.target.value)}
                    placeholder={
                      serverHasLlmKey
                        ? "留空则保留现有密钥"
                        : "sk-..."
                    }
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-onSurface-default-tertiary">
                    当 Embedder 使用同一提供商时也会用到。
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="setup-embedder-provider">
                      Embedder 提供商
                    </Label>
                    <Select
                      value={embedderProvider}
                      onValueChange={setEmbedderProvider}
                      disabled={!providers}
                    >
                      <SelectTrigger id="setup-embedder-provider">
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
                    <Label htmlFor="setup-embedder-model">模型</Label>
                    <Input
                      id="setup-embedder-model"
                      value={embedderModel}
                      onChange={(e) => setEmbedderModel(e.target.value)}
                      placeholder="text-embedding-3-small"
                      className="font-mono text-sm"
                    />
                  </div>
                </div>

                <p className="text-xs text-onSurface-default-tertiary">
                  Need another provider? Install its Python package and rebuild
                  the image. See{" "}
                  <a
                    href={SUPPORTED_PROVIDERS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-4 hover:text-onSurface-default-primary"
                  >
                    supported providers
                  </a>
                  .
                </p>

                <Button
                  type="submit"
                  disabled={
                    isLoading ||
                    !llmProvider ||
                    !embedderProvider ||
                    (!serverHasLlmKey && !llmApiKey)
                  }
                  className="w-full"
                >
                  {isLoading ? "Saving..." : "保存并继续"}
                </Button>
              </form>
            )}

            {step === 2 && !apiKey && (
              <form onSubmit={handleStep3} className="space-y-4">
                <div className="space-y-1">
                  <Label htmlFor="setup-key-label">为该密钥命名</Label>
                  <Input
                    id="setup-key-label"
                    value={keyLabel}
                    onChange={(e) => setKeyLabel(e.target.value)}
                    placeholder="我的第一个密钥"
                  />
                </div>
                <Button type="submit" disabled={isLoading} className="w-full">
                  {isLoading ? "Generating..." : "生成 API 密钥"}
                </Button>
              </form>
            )}

            {step === 2 && apiKey && (
              <form onSubmit={handleContinueToUseCase} className="space-y-4">
                <div className="space-y-1">
                  <Label htmlFor="setup-api-key">你的 API 密钥</Label>
                  <div className="flex gap-2">
                    <Input
                      id="setup-api-key"
                      value={apiKey}
                      readOnly
                      className="font-mono text-sm"
                    />
                    <CopyToClipboard
                      text={apiKey}
                      onCopy={() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                    >
                      <Button variant="outline" size="icon">
                        {copied ? (
                          <Check className="size-4" />
                        ) : (
                          <Copy className="size-4" />
                        )}
                      </Button>
                    </CopyToClipboard>
                  </div>
                  <p className="text-xs text-onSurface-danger-primary">
                    请立即保存此密钥，关闭后将无法再次查看。
                  </p>
                </div>
                <Button type="submit" className="w-full">
                  继续
                </Button>
              </form>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <div className="space-y-1">
                  <Label htmlFor="setup-use-case">描述你的使用场景</Label>
                  <textarea
                    id="setup-use-case"
                    value={useCase}
                    onChange={(e) => setUseCase(e.target.value)}
                    placeholder="e.g. A personal assistant that remembers my preferences"
                    className="flex w-full rounded-md border border-memBorder-primary bg-surface-default-primary px-3 py-2 text-sm placeholder:text-onSurface-default-tertiary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-memPurple-500 min-h-[80px] resize-y"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {USE_CASE_PRESETS.map((preset) => (
                    <Button
                      key={preset}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setUseCase(preset)}
                      className={cn(
                        useCase === preset &&
                          "border-memPurple-500 text-memPurple-500",
                      )}
                    >
                      {preset}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-onSurface-default-tertiary">
                  We&apos;ll generate custom instructions that tell the memory
                  extractor which facts to prioritize for your use case.
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleContinueToQuickTest}
                    className="flex-1"
                  >
                    跳过
                  </Button>
                  <Button
                    type="button"
                    disabled={!useCase || isGeneratingInstructions}
                    className="flex-1"
                    onClick={async () => {
                      setError("");
                      setIsGeneratingInstructions(true);
                      try {
                        const res = await api.post(
                          MEMORY_ENDPOINTS.GENERATE_INSTRUCTIONS,
                          {
                            use_case: useCase,
                          },
                        );
                        setCustomInstructions(res.data.custom_instructions);
                        if (res.data.test_message) {
                          setTestMessage(res.data.test_message);
                        }
                      } catch (err) {
                        setError(
                          getErrorMessage(
                            err,
                            "指引生成失败",
                          ),
                        );
                      } finally {
                        setIsGeneratingInstructions(false);
                      }
                    }}
                  >
                    {isGeneratingInstructions
                      ? "正在生成指引…"
                      : "生成指引"}
                  </Button>
                </div>
                {customInstructions && (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label htmlFor="setup-instructions">
                        已生成指引
                      </Label>
                      <textarea
                        id="setup-instructions"
                        value={customInstructions}
                        onChange={(e) => setCustomInstructions(e.target.value)}
                        className="flex w-full rounded-md border border-memBorder-primary bg-surface-default-primary px-3 py-2 text-sm placeholder:text-onSurface-default-tertiary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-memPurple-500 min-h-[120px] resize-y"
                      />
                    </div>
                    <Button
                      type="button"
                      className="w-full"
                      onClick={async () => {
                        setError("");
                        setIsLoading(true);
                        try {
                          await api.post(MEMORY_ENDPOINTS.CONFIGURE, {
                            custom_instructions: customInstructions,
                          });
                          handleContinueToQuickTest();
                        } catch (err) {
                          setError(
                            getErrorMessage(err, "指引保存失败"),
                          );
                        } finally {
                          setIsLoading(false);
                        }
                      }}
                      disabled={isLoading}
                    >
                      {isLoading ? "Saving..." : "保存并继续"}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {step === 4 && (
              <form
                onSubmit={testSuccess ? handleGoToDashboard : handleTest}
                className="space-y-4"
              >
                <div className="space-y-1">
                  <Label>测试你的配置</Label>
                  {!apiUrl && (
                    <p className="text-xs text-onSurface-danger-primary">
                      NEXT_PUBLIC_API_URL is not set. Set it in .env and restart
                      before running this test.
                    </p>
                  )}
                  <pre className="text-xs bg-surface-default-secondary p-3 rounded font-mono overflow-x-auto">{`curl -X POST ${apiUrl}/memories \\
  -H "X-API-Key: ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"messages": [{"role": "user", "content": "${testMessage}"}], "user_id": "setup-test"}'`}</pre>
                </div>
                {!testSuccess ? (
                  <>
                    <Button
                      type="submit"
                      disabled={isLoading}
                      className="w-full"
                    >
                      {isLoading ? "Testing..." : "运行测试"}
                    </Button>
                    {error && (
                      <p className="text-xs text-onSurface-default-tertiary">
                        Provider credentials or model wrong? Fix them in{" "}
                        <a
                          href="/dashboard/configuration"
                          className="underline underline-offset-4 hover:text-onSurface-default-primary"
                        >
                          配置
                        </a>{" "}
                        and run the test again.
                      </p>
                    )}
                  </>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm text-onSurface-positive-primary">
                      <Check className="size-4" /> 记忆创建成功
                    </div>
                    <Button type="submit" className="w-full">
                      进入控制台
                    </Button>
                  </div>
                )}
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
