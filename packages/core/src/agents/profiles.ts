/**
 * Persistent sub-agent profiles at ~/.luckycli/agents/<name>.json.
 *
 * A profile is a reusable role the main agent can delegate to: a name, a short
 * description of what it's for, and the **provider + model** it runs on. This is
 * the heart of the provider-agnostic sub-agent system — a profile binds a role
 * (e.g. "frontend", "docs") to any provider the user is logged into, so a single
 * piece of work can fan out across models chosen by hand for performance/cost.
 *
 * One JSON file per profile keeps the set inspectable and editable from the
 * /agents menu. Storage mirrors the task store (file-per-item, atomic writes).
 *
 * Phase 1 is sequential single-agent delegation; the `tools` / `systemPrompt`
 * fields are carried as optional so a profile can later constrain a sub-agent's
 * toolset or persona without a storage rewrite.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { PROVIDER_CATALOG } from "../providers/catalog.js";
import { isProviderId } from "../providers/types.js";

export const AgentProfileSchema = z.object({
  /** Stable, path-safe name used to reference the profile (e.g. "frontend"). */
  name: z.string().min(1),
  /** One line on what this sub-agent is for; guides the main agent's choice. */
  description: z.string(),
  /** Provider the sub-agent runs on. Must be one the user is logged into. */
  provider: z.string().refine(isProviderId, "Unknown provider id"),
  /** Model id within that provider. */
  model: z.string().min(1),
  /** Optional toolset restriction (names). Unset = inherit the full registry. */
  tools: z.array(z.string()).optional(),
  /** Optional persona prepended to the sub-agent's system prompt. */
  systemPrompt: z.string().optional(),
});
export type AgentProfile = z.infer<typeof AgentProfileSchema>;

/** Fields supplied when saving a profile (name is the key). */
export type NewAgentProfile = AgentProfile;

/**
 * Make a string safe to use as a single path component. Mirrors the task store
 * so profile names map predictably to filenames.
 */
export function sanitizeProfileName(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]/g, "-");
}

/** Root directory holding every agent profile. */
export function agentsRootDir(): string {
  return join(homedir(), ".luckycli", "agents");
}

function profileFilePath(name: string): string {
  return join(agentsRootDir(), `${sanitizeProfileName(name)}.json`);
}

function ensureAgentsDir(): string {
  const dir = agentsRootDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Atomic write via temp file + rename, matching the task/session stores. */
function writeJsonAtomic(path: string, value: unknown): void {
  const dir = join(path, "..");
  const tmp = join(dir, `.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

/** Read a single profile, or null if it doesn't exist / fails validation. */
export function getProfile(name: string): AgentProfile | null {
  const path = profileFilePath(name);
  if (!existsSync(path)) return null;
  try {
    const parsed = AgentProfileSchema.safeParse(
      JSON.parse(readFileSync(path, "utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Persist a profile (create or overwrite). Returns the saved profile. */
export function saveProfile(data: NewAgentProfile): AgentProfile {
  ensureAgentsDir();
  const profile = AgentProfileSchema.parse(data);
  writeJsonAtomic(profileFilePath(profile.name), profile);
  return profile;
}

/** Delete a profile by name. Returns true if a file was removed. */
export function deleteProfile(name: string): boolean {
  const path = profileFilePath(name);
  if (!existsSync(path)) return false;
  rmSync(path);
  return true;
}

/** All profiles, sorted by name. */
export function listProfiles(): AgentProfile[] {
  const dir = agentsRootDir();
  if (!existsSync(dir)) return [];
  const profiles: AgentProfile[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const profile = getProfile(file.slice(0, -".json".length));
    if (profile) profiles.push(profile);
  }
  return profiles.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Example profiles seeded the first time the /agents menu opens on an empty
 * set, so the user has something to edit rather than a blank slate. Each points
 * at a sensible default model for its role; the user re-assigns providers/models
 * by hand. Only profiles whose provider is in the catalog are seeded, and seeding
 * never overwrites an existing profile.
 */
export function seedDefaultProfiles(): AgentProfile[] {
  if (listProfiles().length > 0) return listProfiles();
  const defaults: NewAgentProfile[] = [
    {
      name: "frontend",
      description: "UI, components, styling and client-side wiring.",
      provider: "gemini",
      model: PROVIDER_CATALOG.gemini.defaultModel,
    },
    {
      name: "backend",
      description: "APIs, data layer, server logic and integration.",
      provider: "claude",
      model: "claude-opus-5",
    },
    {
      name: "docs",
      description: "Documentation, READMEs and comments. Low-cost model.",
      provider: "claude",
      model: "claude-haiku-4-5-20251001",
    },
  ];
  const seeded: AgentProfile[] = [];
  for (const profile of defaults) {
    // Only seed roles whose provider/model exist in the catalog so we never
    // create a profile that can't resolve a model.
    if (!isProviderId(profile.provider)) continue;
    if (getProfile(profile.name)) continue;
    seeded.push(saveProfile(profile));
  }
  return seeded;
}
