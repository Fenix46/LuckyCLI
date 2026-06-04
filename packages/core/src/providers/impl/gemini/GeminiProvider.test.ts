import { beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiProvider } from "./GeminiProvider.js";
import { GoogleGenAI } from "@google/genai";
import { CodeAssistClient } from "./CodeAssistClient.js";
import { refreshAccessToken } from "./GoogleAuthHelper.js";
import { loadStoredConfig, saveStoredConfig } from "../../../config/store.js";
import { CodeAssistRequestError } from "./CodeAssistErrors.js";

const mocks = vi.hoisted(() => ({
  codeAssistGenerateContent: vi.fn(),
  codeAssistGenerateContentStream: vi.fn(),
  codeAssistCountTokens: vi.fn(),
}));

vi.mock("@google/genai", () => {
  const GoogleGenAI = vi.fn().mockImplementation((options) => ({
    clientOptions: options,
    models: {
      generateContent: vi.fn().mockResolvedValue({
        candidates: [
          { content: { parts: [{ text: "mocked response" }] }, finishReason: "STOP" },
        ],
      }),
      generateContentStream: vi.fn().mockResolvedValue([
        {
          candidates: [
            { content: { parts: [{ text: "mocked stream response" }] }, finishReason: "STOP" },
          ],
        },
      ]),
      countTokens: vi.fn().mockResolvedValue({ totalTokens: 42 }),
    },
  }));
  return { GoogleGenAI };
});

vi.mock("./GoogleAuthHelper.js", () => ({
  refreshAccessToken: vi.fn().mockResolvedValue({
    accessToken: "new-access-token",
    expiresAt: 1_700_000_000_000,
  }),
}));

vi.mock("./CodeAssistClient.js", () => ({
  CodeAssistClient: vi.fn().mockImplementation((accessToken) => ({
    generateContent: mocks.codeAssistGenerateContent.mockImplementation(
      async () => {
        await accessToken();
        return {
          candidates: [
            { content: { parts: [{ text: "mocked response" }] }, finishReason: "STOP" },
          ],
        };
      },
    ),
    generateContentStream:
      mocks.codeAssistGenerateContentStream.mockImplementation(async function* () {
        await accessToken();
        yield {
          candidates: [
            { content: { parts: [{ text: "mocked stream response" }] }, finishReason: "STOP" },
          ],
        };
      }),
    countTokens: mocks.codeAssistCountTokens.mockImplementation(async () => {
      await accessToken();
      return { totalTokens: 42 };
    }),
  })),
}));

vi.mock("../../../config/store.js", () => ({
  loadStoredConfig: vi.fn().mockReturnValue({
    credentials: {
      gemini: {
        type: "gemini",
        authMethod: "oauth",
        refreshToken: "mock-refresh-token",
        accessToken: "expired-access-token",
      },
    },
  }),
  saveStoredConfig: vi.fn(),
  providerInfo: vi.fn().mockReturnValue({
    id: "gemini",
    displayName: "Google Gemini",
    defaultModel: "gemini-2.0-flash",
    availableModels: ["gemini-2.0-flash"],
  }),
}));

describe("GeminiProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initializes with api_key by default", () => {
    const provider = new GeminiProvider({
      type: "gemini",
      authMethod: "api_key",
      apiKey: "test-api-key",
    });
    expect(GoogleGenAI).toHaveBeenCalledWith({ apiKey: "test-api-key" });
  });

  it("initializes in Vertex AI mode when authMethod is vertex", () => {
    const provider = new GeminiProvider({
      type: "gemini",
      authMethod: "vertex",
      projectId: "test-project",
      location: "us-west1",
    });
    expect(GoogleGenAI).toHaveBeenCalledWith({
      vertexai: true,
      project: "test-project",
      location: "us-west1",
    });
  });

  it("initializes in OAuth mode when authMethod is oauth", () => {
    const provider = new GeminiProvider({
      type: "gemini",
      authMethod: "oauth",
      accessToken: "test-access-token",
    });
    expect(CodeAssistClient).toHaveBeenCalledOnce();
  });

  it("refreshes oauth token automatically prior to generating content", async () => {
    const provider = new GeminiProvider({
      type: "gemini",
      authMethod: "oauth",
      accessToken: "expired-access-token",
      refreshToken: "mock-refresh-token",
      expiresAt: 1,
    });

    const response = await provider.generate([], { model: "gemini-2.5-pro" });
    expect(refreshAccessToken).toHaveBeenCalledWith("mock-refresh-token");
    expect(mocks.codeAssistGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gemini-2.5-pro" }),
    );
    expect(saveStoredConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: expect.objectContaining({
          gemini: expect.objectContaining({
            accessToken: "new-access-token",
            expiresAt: 1_700_000_000_000,
          }),
        }),
      }),
    );
    expect(response.content[0]).toEqual({ type: "text", text: "mocked response" });
  });

  it("forces a refresh and retries once after a 401 auth failure", async () => {
    vi.mocked(loadStoredConfig).mockReturnValue({
      credentials: {
        antigravity: {
          type: "antigravity",
          authMethod: "oauth",
          refreshToken: "mock-refresh-token",
          accessToken: "stale-access-token",
        },
      },
    });
    const provider = new GeminiProvider({
      type: "antigravity",
      authMethod: "oauth",
      accessToken: "stale-access-token",
      refreshToken: "mock-refresh-token",
    });
    mocks.codeAssistGenerateContent
      .mockRejectedValueOnce(
        new CodeAssistRequestError(401, { error: { message: "invalid credentials" } }, "generateContent", "gemini-2.5-pro"),
      )
      .mockResolvedValueOnce({
        candidates: [
          { content: { parts: [{ text: "mocked response" }] }, finishReason: "STOP" },
        ],
      });

    const response = await provider.generate([], { model: "gemini-2.5-pro" });

    expect(refreshAccessToken).toHaveBeenCalledWith("mock-refresh-token");
    expect(mocks.codeAssistGenerateContent).toHaveBeenCalledTimes(2);
    expect(saveStoredConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: expect.objectContaining({
          antigravity: expect.objectContaining({
            accessToken: "new-access-token",
            expiresAt: 1_700_000_000_000,
          }),
        }),
      }),
    );
    expect(response.content[0]).toEqual({ type: "text", text: "mocked response" });
  });

  it("does not silently fall back to another Code Assist model on rate limits", async () => {
    const provider = new GeminiProvider({
      type: "gemini",
      authMethod: "oauth",
      accessToken: "test-access-token",
    });
    mocks.codeAssistGenerateContent.mockRejectedValueOnce(
      new Error(
        "Code Assist quota exhausted | for gemini-3.1-flash-lite | retry in 28s",
      ),
    );

    await expect(
      provider.generate([], {
        model: "gemini-3.1-flash-lite",
      }),
    ).rejects.toThrow("gemini-3.1-flash-lite");

    expect(mocks.codeAssistGenerateContent).toHaveBeenCalledTimes(1);
    expect(mocks.codeAssistGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gemini-3.1-flash-lite" }),
    );
  });

  it("maps canonical tool calls and results to Gemini function parts", async () => {
    const provider = new GeminiProvider({
      type: "gemini",
      authMethod: "api_key",
      apiKey: "test-api-key",
    });

    await provider.generate(
      [
        { role: "user", content: [{ type: "text", text: "read file" }] },
        {
          role: "assistant",
          content: [
            {
              type: "tool_call",
              id: "call_1",
              name: "read_file",
              arguments: { path: "README.md" },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool_result",
              toolCallId: "call_1",
              name: "read_file",
              content: "contents",
            },
          ],
        },
      ],
      { model: "gemini-test" },
    );

    const instance = (GoogleGenAI as any).mock.results.at(-1).value;
    expect(instance.models.generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        contents: [
          { role: "user", parts: [{ text: "read file" }] },
          {
            role: "model",
            parts: [
              {
                functionCall: {
                  id: "call_1",
                  name: "read_file",
                  args: { path: "README.md" },
                },
              },
            ],
          },
          {
            role: "user",
            parts: [
              {
                functionResponse: {
                  id: "call_1",
                  name: "read_file",
                  response: { output: "contents" },
                },
              },
            ],
          },
        ],
      }),
    );
  });

  it("adds Code Assist thought signatures to tool call history", async () => {
    const provider = new GeminiProvider({
      type: "gemini",
      authMethod: "oauth",
      accessToken: "test-access-token",
    });

    await provider.generate(
      [
        { role: "user", content: [{ type: "text", text: "read file" }] },
        {
          role: "assistant",
          content: [
            {
              type: "tool_call",
              id: "call_1",
              name: "read_file",
              arguments: { path: "README.md" },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool_result",
              toolCallId: "call_1",
              name: "read_file",
              content: "contents",
            },
          ],
        },
      ],
      { model: "gemini-test" },
    );

    expect(mocks.codeAssistGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        contents: expect.arrayContaining([
          expect.objectContaining({
            role: "model",
            parts: [
              expect.objectContaining({
                functionCall: {
                  id: "call_1",
                  name: "read_file",
                  args: { path: "README.md" },
                },
                thoughtSignature: "skip_thought_signature_validator",
              }),
            ],
          }),
        ]),
      }),
    );
  });
});
