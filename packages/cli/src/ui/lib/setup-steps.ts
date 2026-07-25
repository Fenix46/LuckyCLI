/** The wizard's top-level steps, in order. */
export type Step = "theme" | "provider" | "auth" | "credential" | "model";

/** The sub-steps the "credential" step walks through, per auth method. */
export type CredentialSubStep =
  | "input"
  | "api_key"
  | "context"
  | "oauth_code"
  | "project"
  | "region";

/** Sentinel list value: "let me type a model name not in the list". */
export const CUSTOM_MODEL_SENTINEL = " custom-model";

const ALL_STEPS: Array<{ key: Step; label: string }> = [
  { key: "theme", label: "Theme" },
  { key: "provider", label: "Provider" },
  { key: "auth", label: "Login" },
  { key: "credential", label: "Connect" },
  { key: "model", label: "Model" },
];

/** The steps shown in the progress bar; theme is first-run only. */
export function visibleSteps(mode: "initial" | "provider"): Array<{ key: Step; label: string }> {
  return ALL_STEPS.filter((item) => mode === "initial" || item.key !== "theme");
}
