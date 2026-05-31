import { describe, expect, it } from "vitest";
import {
  classifyCodeAssistError,
  CodeAssistQuotaError,
  CodeAssistRequestError,
  CodeAssistValidationError,
} from "./CodeAssistErrors.js";

describe("CodeAssistErrors", () => {
  it("classifies Cloud Code rate limits with model and retry delay", () => {
    const error = classifyCodeAssistError(
      new CodeAssistRequestError(
        429,
        {
          error: {
            code: 429,
            message: "Please retry in 28s",
            status: "RESOURCE_EXHAUSTED",
            details: [
              {
                "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                reason: "RATE_LIMIT_EXCEEDED",
                domain: "cloudcode-pa.googleapis.com",
              },
              {
                "@type": "type.googleapis.com/google.rpc.RetryInfo",
                retryDelay: "28s",
              },
            ],
          },
        },
        "streamGenerateContent",
        "gemini-3.1-pro-preview",
      ),
    );

    expect(error).toBeInstanceOf(CodeAssistQuotaError);
    expect((error as CodeAssistQuotaError).model).toBe("gemini-3.1-pro-preview");
    expect((error as CodeAssistQuotaError).retryDelayMs).toBe(28_000);
    expect((error as Error).message).toContain("gemini-3.1-pro-preview");
  });

  it("classifies validation required errors", () => {
    const error = classifyCodeAssistError(
      new CodeAssistRequestError(
        403,
        {
          error: {
            code: 403,
            message: "Validation required",
            details: [
              {
                "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                reason: "VALIDATION_REQUIRED",
                domain: "cloudcode-pa.googleapis.com",
                metadata: {
                  validation_link: "https://example.test/validate",
                },
              },
            ],
          },
        },
        "loadCodeAssist",
      ),
    );

    expect(error).toBeInstanceOf(CodeAssistValidationError);
    expect((error as CodeAssistValidationError).validationUrl).toBe(
      "https://example.test/validate",
    );
  });
});
