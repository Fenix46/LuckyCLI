import { randomUUID } from "node:crypto";
import {
  GenerateContentResponse,
  type Candidate,
  type Content,
  CountTokensResponse,
} from "@google/genai";
import {
  classifyCodeAssistError,
  CodeAssistRequestError,
} from "./CodeAssistErrors.js";

const CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com";
const CODE_ASSIST_API_VERSION = "v1internal";
const USER_TIER_FREE = "free-tier";
const USER_TIER_LEGACY = "legacy-tier";

interface ClientMetadata {
  ideType?: string;
  platform?: string;
  pluginType?: string;
  duetProject?: string;
}

interface GeminiUserTier {
  id?: string;
  name?: string;
  isDefault?: boolean;
  hasOnboardedPreviously?: boolean;
}

interface IneligibleTier {
  reasonMessage?: string;
  validationUrl?: string;
}

interface LoadCodeAssistResponse {
  currentTier?: GeminiUserTier | null;
  allowedTiers?: GeminiUserTier[] | null;
  ineligibleTiers?: IneligibleTier[] | null;
  cloudaicompanionProject?: string | null;
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

  constructor(private readonly accessToken: () => Promise<string> | string) {}

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

  private async getUser(): Promise<CodeAssistUser> {
    this.user ??= this.setupUser();
    return this.user;
  }

  private async setupUser(): Promise<CodeAssistUser> {
    const projectId =
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GOOGLE_CLOUD_PROJECT_ID ||
      undefined;

    if (projectId && /^\d+$/.test(projectId)) {
      throw new Error(
        "GOOGLE_CLOUD_PROJECT must be a string project ID, not a numeric project number.",
      );
    }

    const metadata = metadataFor(projectId);
    const load = await this.post<LoadCodeAssistResponse>("loadCodeAssist", {
      cloudaicompanionProject: projectId,
      metadata,
    });

    if (load.currentTier) {
      const resolvedProject = load.cloudaicompanionProject ?? projectId;
      if (resolvedProject) return { projectId: resolvedProject };
      throwIneligibleOrProjectError(load);
    }

    const tier = defaultTier(load);
    const onboard = await this.post<LongRunningOperationResponse>("onboardUser", {
      tierId: tier.id,
      cloudaicompanionProject:
        tier.id === USER_TIER_FREE ? undefined : projectId,
      metadata:
        tier.id === USER_TIER_FREE
          ? baseMetadata()
          : metadataFor(projectId),
    });

    const operation = await this.waitForOperation(onboard);
    const onboardedProject = operation.response?.cloudaicompanionProject?.id;
    if (onboardedProject) return { projectId: onboardedProject };
    if (projectId) return { projectId };

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
      "User-Agent": "luckycli/0.1.0",
      Authorization: `Bearer ${await this.accessToken()}`,
    };
  }

  private baseUrl(): string {
    const endpoint = process.env.CODE_ASSIST_ENDPOINT ?? CODE_ASSIST_ENDPOINT;
    const version =
      process.env.CODE_ASSIST_API_VERSION ?? CODE_ASSIST_API_VERSION;
    return `${endpoint}/${version}`;
  }

  private methodUrl(method: string): string {
    return `${this.baseUrl()}:${method}`;
  }

  private operationUrl(name: string): string {
    return `${this.baseUrl()}/${name}`;
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

function baseMetadata(): ClientMetadata {
  return {
    ideType: "IDE_UNSPECIFIED",
    platform: "PLATFORM_UNSPECIFIED",
    pluginType: "GEMINI",
  };
}

function metadataFor(projectId: string | undefined): ClientMetadata {
  return {
    ...baseMetadata(),
    ...(projectId ? { duetProject: projectId } : {}),
  };
}

function defaultTier(load: LoadCodeAssistResponse): GeminiUserTier {
  return (
    load.allowedTiers?.find((tier) => tier.isDefault) ?? {
      id: USER_TIER_LEGACY,
      name: "",
    }
  );
}

function throwIneligibleOrProjectError(load: LoadCodeAssistResponse): never {
  const messages = load.ineligibleTiers
    ?.map((tier) =>
      [tier.reasonMessage, tier.validationUrl].filter(Boolean).join(" "),
    )
    .filter(Boolean);
  if (messages?.length) {
    throw new Error(messages.join("\n"));
  }
  throw new Error(
    "This Google account requires GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_PROJECT_ID for Code Assist.",
  );
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
