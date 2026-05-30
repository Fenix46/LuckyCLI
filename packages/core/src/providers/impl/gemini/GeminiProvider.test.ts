import { describe, expect, it, vi } from "vitest";
import { GeminiProvider } from "./GeminiProvider.js";
import { GoogleGenAI } from "@google/genai";
import { refreshAccessToken } from "./GoogleAuthHelper.js";
import { loadStoredConfig, saveStoredConfig } from "../../../config/store.js";

vi.mock("@google/genai", () => {
  const GoogleGenAI = vi.fn().mockImplementation((options) => ({
    clientOptions: options,
    models: {
      generateContent: vi.fn().mockResolvedValue({
        text: "mocked response",
        candidates: [{ finishReason: "STOP" }],
      }),
      generateContentStream: vi.fn().mockResolvedValue([
        { text: "mocked stream response", candidates: [{ finishReason: "STOP" }] },
      ]),
      countTokens: vi.fn().mockResolvedValue({ totalTokens: 42 }),
    },
  }));
  return { GoogleGenAI };
});

vi.mock("./GoogleAuthHelper.js", () => ({
  refreshAccessToken: vi.fn().mockResolvedValue("new-access-token"),
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
    expect(GoogleGenAI).toHaveBeenCalledWith({
      apiKey: "",
      httpOptions: {
        headers: {
          Authorization: "Bearer test-access-token",
        },
      },
    });
  });

  it("refreshes oauth token automatically prior to generating content", async () => {
    const provider = new GeminiProvider({
      type: "gemini",
      authMethod: "oauth",
      accessToken: "expired-access-token",
      refreshToken: "mock-refresh-token",
    });

    const response = await provider.generate([], { model: "gemini-2.5-pro" });
    expect(refreshAccessToken).toHaveBeenCalledWith("mock-refresh-token");
    expect(GoogleGenAI).toHaveBeenLastCalledWith({
      apiKey: "",
      httpOptions: {
        headers: {
          Authorization: "Bearer new-access-token",
        },
      },
    });
    expect(response.content[0]).toEqual({ type: "text", text: "mocked response" });
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
});
