import { randomUUID } from "node:crypto";
import {
  GenerateContentResponse,
  type Candidate,
  type Content,
  CountTokensResponse,
} from "@google/genai";
import {
  classifyCodeAssistError,
  CodeAssistIneligibleTierError,
  CodeAssistInvalidProjectError,
  CodeAssistProjectRequiredError,
  CodeAssistRequestError,
  CodeAssistValidationError,
} from "./CodeAssistErrors.js";

const CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com";
const CODE_ASSIST_API_VERSION = "v1internal";
const GOOGLE_USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v2/userinfo";
const USER_TIER_FREE = "free-tier";
const USER_TIER_LEGACY = "legacy-tier";
const USER_TIER_STANDARD = "standard-tier";
const VALIDATION_REQUIRED = "VALIDATION_REQUIRED";

interface ClientMetadata {
  ideType?: string;
  ideName?: string;
  ideVersion?: string;
  platform?: string;
  pluginType?: string;
  duetProject?: string;
  [key: string]: unknown;
}

interface GeminiUserTier {
  id?: string;
  name?: string;
  isDefault?: boolean;
  hasOnboardedPreviously?: boolean;
  availableCredits?: Array<Record<string, unknown>>;
}

interface Credits {
  creditType?: string;
  creditAmount?: string;
}

interface IneligibleTier {
  reasonCode?: string;
  reasonMessage?: string;
  validationUrl?: string;
}

interface LoadCodeAssistResponse {
  currentTier?: GeminiUserTier | null;
  allowedTiers?: GeminiUserTier[] | null;
  ineligibleTiers?: IneligibleTier[] | null;
  cloudaicompanionProject?: string | null;
  paidTier?: GeminiUserTier | null;
}

interface LongRunningOperationResponse {
  name?: string;
  done?: boolean;
  response?: {
    cloudaicompanionProject?: {
      id?: string;
    };
  };
}

interface CodeAssistUser {
  projectId: string;
  userTier?: string;
  userTierName?: string;
  paidTier?: GeminiUserTier;
  hasOnboardedPreviously?: boolean;
}

interface CodeAssistGenerateResponse {
  response?: {
    candidates?: Candidate[];
    promptFeedback?: GenerateContentResponse["promptFeedback"];
    usageMetadata?: GenerateContentResponse["usageMetadata"];
    modelVersion?: string;
  };
  traceId?: string;
}

interface CodeAssistCountTokensResponse {
  totalTokens?: number;
}

interface RetrieveUserQuotaResponse {
  buckets?: Array<{
    remainingAmount?: string;
    remainingFraction?: number;
    resetTime?: string;
    tokenType?: string;
    modelId?: string;
  }>;
}

interface GoogleUserInfo {
  email?: string;
  name?: string;
}

interface AvailableModelsResponse {
  models?: Record<
    string,
    {
      displayName?: string;
      maxTokens?: number;
      maxOutputTokens?: number;
      quotaInfo?: {
        remainingAmount?: string;
        remainingFraction?: number;
        resetTime?: string;
      };
    }
  >;
}

export interface CodeAssistClientOptions {
  endpoint?: string;
  apiVersion?: string;
  userAgent?: string;
  headers?: Record<string, string>;
  loadMetadata?: ClientMetadata;
  freeTierMetadata?: ClientMetadata;
  projectEnv?: string[];
  userInfo?: {
    endpoint?: string;
    body?: (projectId: string) => unknown;
  };
  availableModels?: {
    endpoint: string;
    body: (projectId: string) => unknown;
  };
}

export interface CodeAssistStatus {
  account?: string;
  project?: string;
  tier?: string;
  subscription?: string;
  credits?: Credits[];
  quotas?: RetrieveUserQuotaResponse["buckets"];
  models?: AvailableModelsResponse["models"];
  notes?: string[];
}

export interface CodeAssistGenerateRequest {
  model: string;
  contents: Content[];
  systemInstruction?: Content;
  tools?: unknown;
  generationConfig?: Record<string, unknown>;
  abortSignal?: AbortSignal;
}

export class CodeAssistClient {
  private user: Promise<CodeAssistUser> | undefined;
  private readonly sessionId = randomUUID();
  private readonly options: CodeAssistClientOptions;

  constructor(
    private readonly accessToken: () => Promise<string> | string,
    options: CodeAssistClientOptions = {},
  ) {
    this.options = options;
  }

  async generateContent(
    req: CodeAssistGenerateRequest,
  ): Promise<GenerateContentResponse> {
    const user = await this.getUser();
    const response = await this.post<CodeAssistGenerateResponse>(
      "generateContent",
      {
        model: req.model,
        project: user.projectId,
        user_prompt_id: randomUUID(),
        request: {
          contents: req.contents,
          ...(req.systemInstruction
            ? { systemInstruction: req.systemInstruction }
            : {}),
          ...(req.tools ? { tools: req.tools } : {}),
          ...(req.generationConfig
            ? { generationConfig: req.generationConfig }
            : {}),
          session_id: this.sessionId,
        },
      },
      req.abortSignal,
      req.model,
    );

    return toGenerateContentResponse(response);
  }

  async *generateContentStream(
    req: CodeAssistGenerateRequest,
  ): AsyncGenerator<GenerateContentResponse> {
    const user = await this.getUser();
    const chunks = await this.streamingPost<CodeAssistGenerateResponse>(
      "streamGenerateContent",
      {
        model: req.model,
        project: user.projectId,
        user_prompt_id: randomUUID(),
        request: {
          contents: req.contents,
          ...(req.systemInstruction
            ? { systemInstruction: req.systemInstruction }
            : {}),
          ...(req.tools ? { tools: req.tools } : {}),
          ...(req.generationConfig
            ? { generationConfig: req.generationConfig }
            : {}),
          session_id: this.sessionId,
        },
      },
      req.abortSignal,
      req.model,
    );

    for await (const chunk of chunks) {
      yield toGenerateContentResponse(chunk);
    }
  }

  async countTokens(
    model: string,
    contents: Content[],
    signal?: AbortSignal,
  ): Promise<CountTokensResponse> {
    const response = await this.post<CodeAssistCountTokensResponse>(
      "countTokens",
      {
        request: {
          model: `models/${model}`,
          contents,
        },
      },
      signal,
      model,
    );
    return { totalTokens: response.totalTokens ?? 0 };
  }

  async getStatus(): Promise<CodeAssistStatus> {
    const user = await this.getUser();
    const [account, quotas, models] = await Promise.all([
      this.fetchUserInfo(user.projectId).catch(() => undefined),
      this.retrieveQuota(user.projectId).catch(() => undefined),
      this.fetchAvailableModels(user.projectId).catch(() => undefined),
    ]);
    return {
      ...(account?.email ? { account: account.email } : {}),
      project: user.projectId,
      ...(user.userTierName || user.userTier
        ? { tier: user.userTierName ?? user.userTier }
        : {}),
      ...(user.paidTier?.name || user.paidTier?.id
        ? { subscription: user.paidTier.name ?? user.paidTier.id }
        : {}),
      ...(user.paidTier?.availableCredits
        ? { credits: user.paidTier.availableCredits }
        : {}),
      ...(quotas?.buckets ? { quotas: quotas.buckets } : {}),
      ...(models?.models ? { models: models.models } : {}),
      ...(!quotas?.buckets
        ? { notes: ["Code Assist quota buckets are not available from this account/endpoint."] }
        : {}),
    };
  }

  private async getUser(): Promise<CodeAssistUser> {
    this.user ??= this.setupUser();
    return this.user;
  }

  private async setupUser(): Promise<CodeAssistUser> {
    const projectId =
      this.projectFromEnv() ||
      undefined;

    if (projectId && /^\d+$/.test(projectId)) {
      throw new CodeAssistInvalidProjectError(projectId);
    }

    const metadata = this.metadataFor(projectId);
    const load = await this.post<LoadCodeAssistResponse>("loadCodeAssist", {
      cloudaicompanionProject: projectId,
      metadata,
    });
    validateLoadCodeAssist(load);

    if (load.currentTier) {
      const resolvedProject = load.cloudaicompanionProject ?? projectId;
      if (resolvedProject) {
        return {
          projectId: resolvedProject,
          userTier:
            load.paidTier?.id ?? load.currentTier.id ?? USER_TIER_STANDARD,
          userTierName: load.paidTier?.name ?? load.currentTier.name,
          paidTier: load.paidTier ?? undefined,
          hasOnboardedPreviously:
            load.currentTier.hasOnboardedPreviously ?? true,
        };
      }
      throwIneligibleOrProjectError(load);
    }

    const tier = defaultTier(load);
    const onboard = await this.post<LongRunningOperationResponse>("onboardUser", {
      tierId: tier.id,
      cloudaicompanionProject:
        tier.id === USER_TIER_FREE ? undefined : projectId,
      metadata:
        tier.id === USER_TIER_FREE
          ? this.freeTierMetadata()
          : this.metadataFor(projectId),
    });

    const operation = await this.waitForOperation(onboard);
    const onboardedProject = operation.response?.cloudaicompanionProject?.id;
    const fallbackProject = onboardedProject ?? projectId;
    if (fallbackProject) {
      return {
        projectId: fallbackProject,
        userTier: tier.id ?? USER_TIER_STANDARD,
        userTierName: tier.name,
        hasOnboardedPreviously: tier.hasOnboardedPreviously ?? false,
      };
    }

    throwIneligibleOrProjectError(load);
  }

  private async waitForOperation(
    operation: LongRunningOperationResponse,
  ): Promise<LongRunningOperationResponse> {
    let current = operation;
    while (!current.done && current.name) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      current = await this.get<LongRunningOperationResponse>(current.name);
    }
    return current;
  }

  private async post<T>(
    method: string,
    body: unknown,
    signal?: AbortSignal,
    model?: string,
  ): Promise<T> {
    const res = await fetch(this.methodUrl(method), {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify(body),
      signal,
    });
    return readJsonResponse<T>(res, method, model);
  }

  private async get<T>(operationName: string, signal?: AbortSignal): Promise<T> {
    const res = await fetch(this.operationUrl(operationName), {
      method: "GET",
      headers: await this.headers(),
      signal,
    });
    return readJsonResponse<T>(res, "getOperation");
  }

  private async retrieveQuota(projectId: string): Promise<RetrieveUserQuotaResponse> {
    return this.post<RetrieveUserQuotaResponse>("retrieveUserQuota", {
      project: projectId,
      userAgent: "luckycli/0.1.1",
    });
  }

  private async fetchUserInfo(projectId: string): Promise<GoogleUserInfo> {
    const endpoint = this.options.userInfo?.endpoint ?? GOOGLE_USERINFO_ENDPOINT;
    const body = this.options.userInfo?.body?.(projectId);
    const res = await fetch(endpoint, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        ...(this.options.userAgent ? { "User-Agent": this.options.userAgent } : {}),
        ...(this.options.headers ?? {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) throw new Error(`Google userinfo failed (${res.status})`);
    return (await res.json()) as GoogleUserInfo;
  }

  private async fetchAvailableModels(projectId: string): Promise<AvailableModelsResponse | undefined> {
    if (!this.options.availableModels) return undefined;
    const res = await fetch(this.options.availableModels.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        "Content-Type": "application/json",
        ...(this.options.userAgent ? { "User-Agent": this.options.userAgent } : {}),
        ...(this.options.headers ?? {}),
      },
      body: JSON.stringify(this.options.availableModels.body(projectId)),
    });
    if (!res.ok) throw new Error(`Code Assist available models failed (${res.status})`);
    return (await res.json()) as AvailableModelsResponse;
  }

  private async streamingPost<T>(
    method: string,
    body: unknown,
    signal?: AbortSignal,
    model?: string,
  ): Promise<AsyncGenerator<T>> {
    const res = await fetch(`${this.methodUrl(method)}?alt=sse`, {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) await readJsonResponse(res, method, model ?? bodyModel(body));
    if (!res.body) throw new Error("Code Assist returned an empty stream.");
    return parseSse<T>(res.body);
  }

  private async headers(): Promise<Record<string, string>> {
    return {
      "Content-Type": "application/json",
      "User-Agent": this.options.userAgent ?? "luckycli/0.1.1",
      Authorization: `Bearer ${await this.accessToken()}`,
      ...(this.options.headers ?? {}),
    };
  }

  private baseUrl(): string {
    const endpoint = this.options.endpoint ?? process.env.CODE_ASSIST_ENDPOINT ?? CODE_ASSIST_ENDPOINT;
    const version =
      this.options.apiVersion ?? process.env.CODE_ASSIST_API_VERSION ?? CODE_ASSIST_API_VERSION;
    return `${endpoint}/${version}`;
  }

  private methodUrl(method: string): string {
    return `${this.baseUrl()}:${method}`;
  }

  private operationUrl(name: string): string {
    return `${this.baseUrl()}/${name}`;
  }

  private projectFromEnv(): string | undefined {
    const keys = this.options.projectEnv ?? ["GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT_ID"];
    for (const key of keys) {
      const value = process.env[key];
      if (value) return value;
    }
    return undefined;
  }

  private baseMetadata(): ClientMetadata {
    return this.options.loadMetadata ?? {
      ideType: "IDE_UNSPECIFIED",
      platform: "PLATFORM_UNSPECIFIED",
      pluginType: "GEMINI",
    };
  }

  private freeTierMetadata(): ClientMetadata {
    return this.options.freeTierMetadata ?? this.baseMetadata();
  }

  private metadataFor(projectId: string | undefined): ClientMetadata {
    return {
      ...this.baseMetadata(),
      ...(projectId ? { duetProject: projectId } : {}),
    };
  }
}

function toGenerateContentResponse(
  res: CodeAssistGenerateResponse,
): GenerateContentResponse {
  const out = new GenerateContentResponse();
  out.responseId = res.traceId;
  out.candidates = res.response?.candidates ?? [];
  out.promptFeedback = res.response?.promptFeedback;
  out.usageMetadata = res.response?.usageMetadata;
  out.modelVersion = res.response?.modelVersion;
  return out;
}

function defaultTier(load: LoadCodeAssistResponse): GeminiUserTier {
  return (
    load.allowedTiers?.find((tier) => tier.isDefault) ?? {
      id: USER_TIER_LEGACY,
      name: "",
    }
  );
}

function validateLoadCodeAssist(load: LoadCodeAssistResponse): void {
  const validationTier = load.ineligibleTiers?.find(
    (tier) => tier.reasonCode === VALIDATION_REQUIRED && tier.validationUrl,
  );
  if (!load.currentTier && validationTier?.validationUrl) {
    throw new CodeAssistValidationError(
      validationTier.reasonMessage
        ? `Google account validation is required: ${validationTier.reasonMessage}`
        : "Google account validation is required.",
      validationTier.validationUrl,
    );
  }
}

function throwIneligibleOrProjectError(load: LoadCodeAssistResponse): never {
  const messages = load.ineligibleTiers
    ?.map((tier) =>
      [tier.reasonMessage, tier.validationUrl].filter(Boolean).join(" "),
    )
    .filter(Boolean);
  if (messages?.length) {
    throw new CodeAssistIneligibleTierError(messages);
  }
  throw new CodeAssistProjectRequiredError();
}

async function readJsonResponse<T>(
  res: Response,
  method: string,
  model?: string,
): Promise<T> {
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }

  if (!res.ok) {
    throw classifyCodeAssistError(
      new CodeAssistRequestError(
        res.status,
        data || text || res.statusText,
        method,
        model,
      ),
    );
  }

  return data as T;
}

function bodyModel(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  return (body as { model?: unknown }).model as string | undefined;
}

async function* parseSse<T>(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<T> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines: string[] = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
      const rawLine = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      const line = rawLine.replace(/\r$/, "");

      if (line.startsWith("data: ")) {
        dataLines.push(line.slice(6).trim());
      } else if (line === "") {
        if (dataLines.length > 0) {
          yield JSON.parse(dataLines.join("\n")) as T;
          dataLines = [];
        }
      }
    }
  }

  const tail = decoder.decode();
  if (tail) buffer += tail;
  if (buffer.startsWith("data: ")) dataLines.push(buffer.slice(6).trim());
  if (dataLines.length > 0) yield JSON.parse(dataLines.join("\n")) as T;
}
