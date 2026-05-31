import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodeAssistClient } from "./CodeAssistClient.js";
import {
  CodeAssistInvalidProjectError,
  CodeAssistValidationError,
} from "./CodeAssistErrors.js";

describe("CodeAssistClient", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_PROJECT_ID;
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_PROJECT_ID;
  });

  it("uses one stable Code Assist session id for a client instance", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ currentTier: {}, cloudaicompanionProject: "p1" }),
      )
      .mockResolvedValueOnce(jsonResponse({ response: { candidates: [] } }))
      .mockResolvedValueOnce(jsonResponse({ response: { candidates: [] } }));

    const client = new CodeAssistClient(() => "access-token");

    await client.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: [{ role: "user", parts: [{ text: "one" }] }],
    });
    await client.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: [{ role: "user", parts: [{ text: "two" }] }],
    });

    const firstGenerateBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    const secondGenerateBody = JSON.parse(fetchMock.mock.calls[2][1].body);

    expect(firstGenerateBody.request.session_id).toBeTruthy();
    expect(secondGenerateBody.request.session_id).toBe(
      firstGenerateBody.request.session_id,
    );
    expect(secondGenerateBody.user_prompt_id).not.toBe(
      firstGenerateBody.user_prompt_id,
    );
  });

  it("uses GOOGLE_CLOUD_PROJECT when Code Assist returns a current tier without project", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "my-project-123";
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          currentTier: { id: "standard-tier", name: "Standard" },
          paidTier: { id: "pro-tier", name: "Pro" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ response: { candidates: [] } }));

    const client = new CodeAssistClient(() => "access-token");
    await client.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
    });

    const loadBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const generateBody = JSON.parse(fetchMock.mock.calls[1][1].body);

    expect(loadBody.cloudaicompanionProject).toBe("my-project-123");
    expect(loadBody.metadata.duetProject).toBe("my-project-123");
    expect(generateBody.project).toBe("my-project-123");
  });

  it("does not send a user project when onboarding the free tier", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "my-project-123";
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          allowedTiers: [{ id: "free-tier", name: "Free", isDefault: true }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          done: true,
          response: { cloudaicompanionProject: { id: "managed-project" } },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ response: { candidates: [] } }));

    const client = new CodeAssistClient(() => "access-token");
    await client.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
    });

    const onboardBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    const generateBody = JSON.parse(fetchMock.mock.calls[2][1].body);

    expect(onboardBody.tierId).toBe("free-tier");
    expect(onboardBody).not.toHaveProperty("cloudaicompanionProject");
    expect(onboardBody.metadata).not.toHaveProperty("duetProject");
    expect(generateBody.project).toBe("managed-project");
  });

  it("rejects numeric Google Cloud project ids", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "123456789";
    const client = new CodeAssistClient(() => "access-token");

    await expect(
      client.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: [{ role: "user", parts: [{ text: "hello" }] }],
      }),
    ).rejects.toBeInstanceOf(CodeAssistInvalidProjectError);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces validation required from loadCodeAssist", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ineligibleTiers: [
          {
            reasonCode: "VALIDATION_REQUIRED",
            reasonMessage: "Verify your account",
            validationUrl: "https://example.test/validate",
          },
        ],
      }),
    );

    const client = new CodeAssistClient(() => "access-token");

    await expect(
      client.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: [{ role: "user", parts: [{ text: "hello" }] }],
      }),
    ).rejects.toMatchObject({
      name: "CodeAssistValidationError",
      validationUrl: "https://example.test/validate",
    } satisfies Partial<CodeAssistValidationError>);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns account, tier and quota buckets for status", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          currentTier: { id: "standard-tier", name: "Standard" },
          cloudaicompanionProject: "p1",
          paidTier: {
            id: "google-one-ai-premium",
            name: "Google One AI Premium",
            availableCredits: [
              { creditType: "GOOGLE_ONE_AI", creditAmount: "500" },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ email: "user@example.com" }))
      .mockResolvedValueOnce(
        jsonResponse({
          buckets: [
            {
              tokenType: "rolling_5h",
              remainingAmount: "42",
              resetTime: "2026-05-31T12:00:00Z",
            },
          ],
        }),
      );

    const client = new CodeAssistClient(() => "access-token");
    const status = await client.getStatus();

    expect(status.account).toBe("user@example.com");
    expect(status.project).toBe("p1");
    expect(status.tier).toBe("Google One AI Premium");
    expect(status.subscription).toBe("Google One AI Premium");
    expect(status.credits?.[0]?.creditAmount).toBe("500");
    expect(status.quotas?.[0]?.tokenType).toBe("rolling_5h");

    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://www.googleapis.com/oauth2/v2/userinfo",
    );
    expect(fetchMock.mock.calls[2][0]).toContain(":retrieveUserQuota");
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
