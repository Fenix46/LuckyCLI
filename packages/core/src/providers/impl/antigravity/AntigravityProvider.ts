import type { AntigravityCredentials } from "../../types.js";
import { providerInfo } from "../../catalog.js";
import { refreshAntigravityAccessToken } from "../gemini/GoogleAuthHelper.js";
import { GeminiProvider } from "../gemini/GeminiProvider.js";

const ANTIGRAVITY_ENDPOINT = "https://cloudcode-pa.googleapis.com";
const ANTIGRAVITY_DAILY_ENDPOINT = "https://daily-cloudcode-pa.googleapis.com";
const ANTIGRAVITY_API_VERSION = "v1internal";
const ANTIGRAVITY_IDE_VERSION = "2.0.3";
const ANTIGRAVITY_USER_AGENT =
  "antigravity/2.0.3 darwin/arm64 google-api-nodejs-client/10.3.0";

export class AntigravityProvider extends GeminiProvider {
  constructor(credentials: AntigravityCredentials) {
    super(credentials, {
      info: providerInfo("antigravity"),
      refreshAccessToken: refreshAntigravityAccessToken,
      codeAssist: {
        endpoint: ANTIGRAVITY_ENDPOINT,
        apiVersion: ANTIGRAVITY_API_VERSION,
        userAgent: ANTIGRAVITY_USER_AGENT,
        headers: {
          "x-goog-api-client": "gl-node/22.21.1",
        },
        loadMetadata: {
          ide_type: "ANTIGRAVITY",
          ide_version: ANTIGRAVITY_IDE_VERSION,
          ide_name: "antigravity",
        },
        freeTierMetadata: {
          ide_type: "ANTIGRAVITY",
          ide_version: ANTIGRAVITY_IDE_VERSION,
          ide_name: "antigravity",
        },
        projectEnv: ["ANTIGRAVITY_PROJECT", "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT_ID"],
        availableModels: {
          endpoint: `${ANTIGRAVITY_DAILY_ENDPOINT}/${ANTIGRAVITY_API_VERSION}:fetchAvailableModels`,
          body: (project) => ({ project }),
        },
      },
    });
  }
}
