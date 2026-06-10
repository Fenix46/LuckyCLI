import { useCallback, useEffect, useState } from "react";
import {
  SkillCatalog,
  discoverSkills,
  installCatalogSkill,
  setSkillEnabled,
  uninstallSkill,
  type CatalogSkill,
  type DiscoveredSkill,
} from "@luckycli/core";
import { buildInstalledSkillRows, type InstalledSkillRow } from "../lib/skill-rows.js";
import type { Item } from "../lib/items.js";
import type { SkillPanelTab } from "../components/SkillPanel.js";
import type { ModalHandler } from "./useModalRouter.js";

/** Left/right/tab flips between the two tabs. Pure, exported for tests. */
export function toggleTab(tab: SkillPanelTab): SkillPanelTab {
  return tab === "installed" ? "search" : "installed";
}

export interface UseSkillPanelOptions {
  emit(item: Item): void;
  /** Rebuilt the agent's system prompt may want to react to skill presence. */
  onSkillsChanged?(): void;
}

export interface SkillPanelController {
  isOpen: boolean;
  open(tab: SkillPanelTab, query?: string): void;
  handler: ModalHandler;
  panelProps: {
    tab: SkillPanelTab;
    installedRows: InstalledSkillRow[];
    selectedInstalledIndex: number;
    pendingRemoval: string | null;
    query: string;
    results: CatalogSkill[];
    selectedSearchIndex: number;
    loading: boolean;
    error: string | null;
  };
}

/**
 * The /skill control panel state machine: tabs, installed-skill actions
 * (toggle enable/disable, remove-with-confirm), debounced catalog search and
 * install. Mirrors useMcpPanel; App keeps only the open() call and render slot.
 */
export function useSkillPanel(options: UseSkillPanelOptions): SkillPanelController {
  const { emit, onSkillsChanged } = options;
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<SkillPanelTab>("installed");
  const [installed, setInstalled] = useState<DiscoveredSkill[]>([]);
  const [selectedInstalledIndex, setSelectedInstalledIndex] = useState(0);
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogSkill[]>([]);
  const [selectedSearchIndex, setSelectedSearchIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const installedRows = buildInstalledSkillRows(installed);

  // Reload installed skills whenever the panel opens or the installed tab is shown.
  const reloadInstalled = useCallback(() => {
    void discoverSkills()
      .then((skills) => setInstalled(skills))
      .catch((e) => setError(e instanceof Error ? e.message : "failed to read installed skills"));
  }, []);

  useEffect(() => {
    if (isOpen) reloadInstalled();
  }, [isOpen, reloadInstalled]);

  useEffect(() => {
    setSelectedInstalledIndex(0);
    setPendingRemoval(null);
  }, [isOpen, tab, installed.length]);

  useEffect(() => {
    setSelectedSearchIndex(0);
  }, [isOpen, tab, query, results.length]);

  // Debounced live search against the catalog while the search tab is open.
  useEffect(() => {
    if (!isOpen || tab !== "search") return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      void new SkillCatalog()
        .search(query.trim())
        .then((items) => {
          if (cancelled) return;
          setResults(items);
          setLoading(false);
        })
        .catch((e) => {
          if (cancelled) return;
          setResults([]);
          setLoading(false);
          setError(e instanceof Error ? e.message : "failed to search the skill catalog");
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, tab, query]);

  const open = useCallback((nextTab: SkillPanelTab, nextQuery = "") => {
    setIsOpen(true);
    setTab(nextTab);
    setQuery(nextQuery);
    setError(null);
    setPendingRemoval(null);
    if (nextTab === "installed") {
      setResults([]);
      setLoading(false);
    }
  }, []);

  function toggleInstalled(row: InstalledSkillRow): void {
    void setSkillEnabled(row.name, !row.enabled)
      .then((ok) => {
        if (!ok) return;
        emit({
          kind: "command",
          title: "Skill updated",
          rows: [
            { label: "skill", value: row.name },
            { label: "enabled", value: row.enabled ? "false" : "true" },
          ],
        });
        reloadInstalled();
        onSkillsChanged?.();
      })
      .catch((e) => setError(e instanceof Error ? e.message : "failed to toggle skill"));
  }

  function confirmRemoval(name: string): void {
    void uninstallSkill(name)
      .then((ok) => {
        setPendingRemoval(null);
        if (!ok) {
          setError(`no installed skill named "${name}"`);
          return;
        }
        emit({ kind: "command", title: "Skill removed", rows: [{ label: "skill", value: name }] });
        reloadInstalled();
        onSkillsChanged?.();
      })
      .catch((e) => {
        setPendingRemoval(null);
        setError(e instanceof Error ? e.message : "failed to remove skill");
      });
  }

  function installSelected(entry: CatalogSkill): void {
    setLoading(true);
    setError(null);
    void installCatalogSkill(entry.name)
      .then((res) => {
        setLoading(false);
        emit({
          kind: "command",
          title: "Skill installed",
          rows: [
            { label: "skill", value: res.name },
            { label: "source", value: "catalog" },
          ],
        });
        setTab("installed");
        setQuery("");
        reloadInstalled();
        onSkillsChanged?.();
      })
      .catch((e) => {
        setLoading(false);
        setError(e instanceof Error ? e.message : "failed to install skill");
      });
  }

  const handler: ModalHandler = {
    active: isOpen,
    onInput(input, key) {
      if (key.escape) {
        if (pendingRemoval) {
          setPendingRemoval(null);
          return true;
        }
        setIsOpen(false);
        setError(null);
        return true;
      }

      // A pending removal captures y/n before anything else.
      if (pendingRemoval) {
        if (input === "y" || input === "Y") confirmRemoval(pendingRemoval);
        else if (input === "n" || input === "N") setPendingRemoval(null);
        return true;
      }

      if (key.leftArrow || key.rightArrow || key.tab) {
        setTab(toggleTab);
        setError(null);
        return true;
      }

      if (tab === "installed") {
        if (installedRows.length > 0 && key.downArrow) {
          setSelectedInstalledIndex((p) => (p + 1) % installedRows.length);
          return true;
        }
        if (installedRows.length > 0 && key.upArrow) {
          setSelectedInstalledIndex((p) => (p - 1 + installedRows.length) % installedRows.length);
          return true;
        }
        const selected = installedRows[selectedInstalledIndex];
        if (key.return && selected) {
          toggleInstalled(selected);
          return true;
        }
        if ((input === "d" || input === "D") && selected) {
          setPendingRemoval(selected.name);
          return true;
        }
        return true;
      }

      // search tab
      if (results.length > 0 && key.downArrow) {
        setSelectedSearchIndex((p) => (p + 1) % results.length);
        return true;
      }
      if (results.length > 0 && key.upArrow) {
        setSelectedSearchIndex((p) => (p - 1 + results.length) % results.length);
        return true;
      }
      if (key.backspace || key.delete) {
        if (query.length > 0) setQuery((p) => p.slice(0, -1));
        return true;
      }
      if (key.return) {
        const selected = results[selectedSearchIndex];
        if (selected) installSelected(selected);
        return true;
      }
      if (!key.ctrl && !key.meta && !key.return && input) {
        setQuery((p) => p + input);
      }
      return true; // panel owns the keyboard while open
    },
  };

  return {
    isOpen,
    open,
    handler,
    panelProps: {
      tab,
      installedRows,
      selectedInstalledIndex,
      pendingRemoval,
      query,
      results,
      selectedSearchIndex,
      loading,
      error,
    },
  };
}
