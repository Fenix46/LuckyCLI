import { useMemo, useState } from "react";
import {
  PROVIDER_CATALOG,
  deleteProfile,
  isProviderId,
  listProfiles,
  loadStoredConfig,
  saveProfile,
  seedDefaultProfiles,
  type AgentProfile,
  type ProviderId,
} from "@luckycli/core";
import {
  AGENT_DRAFT_FIELDS,
  type AgentDraft,
  type AgentsPanelView,
} from "../components/AgentsPanel.js";
import type { ModalHandler } from "./useModalRouter.js";

/** Models available for a provider, from the static catalog. */
export function modelsFor(provider: ProviderId): string[] {
  return PROVIDER_CATALOG[provider]?.availableModels ?? [];
}

/** Cycle the draft's provider (and reset its model to that provider's default). */
export function cycleProvider(draft: AgentDraft, dir: 1 | -1): AgentDraft {
  const ids = Object.keys(PROVIDER_CATALOG) as ProviderId[];
  const i = ids.indexOf(draft.provider);
  const nextProvider = ids[(i + dir + ids.length) % ids.length] ?? draft.provider;
  const models = modelsFor(nextProvider);
  return { ...draft, provider: nextProvider, model: models[0] ?? draft.model };
}

/** Cycle the draft's model within its current provider. */
export function cycleModel(draft: AgentDraft, dir: 1 | -1): AgentDraft {
  const models = modelsFor(draft.provider);
  if (models.length === 0) return draft;
  const i = Math.max(0, models.indexOf(draft.model));
  return { ...draft, model: models[(i + dir + models.length) % models.length] ?? draft.model };
}

/** Why a draft cannot be saved, or null when it is valid. */
export function draftError(draft: AgentDraft, profiles: AgentProfile[]): string | null {
  const name = draft.name.trim();
  if (!name) return "Name is required.";
  // Block a rename/create that would collide with a different existing profile.
  const collision = profiles.find((p) => p.name === name && p.name !== draft.original);
  if (collision) return `A sub-agent named "${name}" already exists.`;
  return null;
}

/** Keep the selection in range after a delete. */
export function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(index, length - 1));
}

export interface AgentsPanelController {
  isOpen: boolean;
  open(): void;
  /** Keyboard state machine, slotted into App's modal precedence chain. */
  handler: ModalHandler;
  /** Data props for <AgentsPanel>; App adds theme/width. */
  panelProps: {
    view: AgentsPanelView;
    profiles: AgentProfile[];
    selectedIndex: number;
    draft: AgentDraft | null;
    fieldIndex: number;
    loggedInProviders: Set<ProviderId>;
    error: string | null;
  };
}

/**
 * The /agents control panel state machine: profile list navigation plus the
 * inline create/edit draft form. App keeps only the open() call and the
 * render slot.
 */
export function useAgentsPanel(): AgentsPanelController {
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<AgentsPanelView>("list");
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [draft, setDraft] = useState<AgentDraft | null>(null);
  const [fieldIndex, setFieldIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Providers the user is logged into, recomputed when the panel opens so a
  // fresh login is reflected.
  const loggedInProviders = useMemo(() => {
    const creds = loadStoredConfig().credentials ?? {};
    return new Set(Object.keys(creds).filter(isProviderId) as ProviderId[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  function refreshProfiles(): AgentProfile[] {
    const next = listProfiles();
    setProfiles(next);
    return next;
  }

  function open(): void {
    // Seed example profiles the first time so the list isn't blank.
    seedDefaultProfiles();
    refreshProfiles();
    setView("list");
    setSelectedIndex(0);
    setDraft(null);
    setFieldIndex(0);
    setError(null);
    setIsOpen(true);
  }

  /** Validate and persist the current draft, then return to the list. */
  function commitDraft(): void {
    if (!draft) return;
    const validationError = draftError(draft, profiles);
    if (validationError) {
      setError(validationError);
      return;
    }
    const name = draft.name.trim();
    try {
      // On rename, remove the old file so it doesn't linger as a duplicate.
      if (draft.original && draft.original !== name) deleteProfile(draft.original);
      saveProfile({
        name,
        description: draft.description.trim(),
        provider: draft.provider,
        model: draft.model,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to save sub-agent");
      return;
    }
    const next = refreshProfiles();
    setView("list");
    setDraft(null);
    setError(null);
    const idx = next.findIndex((p) => p.name === name);
    setSelectedIndex(idx >= 0 ? idx : 0);
  }

  const handler: ModalHandler = {
    active: isOpen,
    onInput(_in, key) {
      if (view === "list") {
        if (key.escape) {
          setIsOpen(false);
          setError(null);
          return true;
        }
        if (profiles.length > 0 && key.downArrow) {
          setSelectedIndex((prev) => (prev + 1) % profiles.length);
          return true;
        }
        if (profiles.length > 0 && key.upArrow) {
          setSelectedIndex((prev) => (prev - 1 + profiles.length) % profiles.length);
          return true;
        }
        if (_in === "n" || _in === "N") {
          const provider = (Object.keys(PROVIDER_CATALOG) as ProviderId[])[0] ?? "claude";
          setDraft({
            original: null,
            name: "",
            description: "",
            provider,
            model: modelsFor(provider)[0] ?? PROVIDER_CATALOG[provider].defaultModel,
          });
          setFieldIndex(0);
          setError(null);
          setView("edit");
          return true;
        }
        const selected = profiles[selectedIndex];
        if ((_in === "e" || _in === "E") && selected) {
          setDraft({
            original: selected.name,
            name: selected.name,
            description: selected.description,
            provider: selected.provider,
            model: selected.model,
          });
          setFieldIndex(0);
          setError(null);
          setView("edit");
          return true;
        }
        if ((_in === "d" || _in === "D") && selected) {
          deleteProfile(selected.name);
          const next = refreshProfiles();
          setSelectedIndex((prev) => clampIndex(prev, next.length));
        }
        return true;
      }

      // edit view
      if (key.escape) {
        setView("list");
        setDraft(null);
        setError(null);
        return true;
      }
      if (key.downArrow || key.tab) {
        setFieldIndex((prev) => (prev + 1) % AGENT_DRAFT_FIELDS.length);
        return true;
      }
      if (key.upArrow) {
        setFieldIndex((prev) => (prev - 1 + AGENT_DRAFT_FIELDS.length) % AGENT_DRAFT_FIELDS.length);
        return true;
      }
      if (key.return) {
        commitDraft();
        return true;
      }
      const field = AGENT_DRAFT_FIELDS[fieldIndex];
      if (field === "provider") {
        if (key.leftArrow) setDraft((prev) => (prev ? cycleProvider(prev, -1) : prev));
        else if (key.rightArrow) setDraft((prev) => (prev ? cycleProvider(prev, 1) : prev));
        return true;
      }
      if (field === "model") {
        if (key.leftArrow) setDraft((prev) => (prev ? cycleModel(prev, -1) : prev));
        else if (key.rightArrow) setDraft((prev) => (prev ? cycleModel(prev, 1) : prev));
        return true;
      }
      // name / description: free text editing
      const textField: "name" | "description" =
        field === "description" ? "description" : "name";
      if (key.backspace || key.delete) {
        setDraft((prev) =>
          prev ? { ...prev, [textField]: prev[textField].slice(0, -1) } : prev,
        );
        return true;
      }
      if (!key.ctrl && !key.meta && _in) {
        setDraft((prev) =>
          prev ? { ...prev, [textField]: prev[textField] + _in } : prev,
        );
      }
      return true; // panel owns the keyboard while open
    },
  };

  return {
    isOpen,
    open,
    handler,
    panelProps: { view, profiles, selectedIndex, draft, fieldIndex, loggedInProviders, error },
  };
}
