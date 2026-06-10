import { useCallback, useEffect, useState } from "react";
import {
  OfficialMcpRegistryCatalog,
  loadStoredConfig,
  saveStoredConfig,
  withMcpServer,
  withoutMcpServer,
  type CatalogServerSummary,
  type McpServerConfig,
} from "@luckycli/core";
import { installCatalogServer } from "../commands/mcp.js";
import { buildInstalledMcpRows, type InstalledMcpRow } from "../lib/mcp-rows.js";
import type { Item } from "../lib/items.js";
import type { McpPanelTab } from "../components/McpPanel.js";
import type { ModalHandler } from "./useModalRouter.js";

/** Left/right/tab flips between the two tabs. Pure, exported for tests. */
export function toggleTab(tab: McpPanelTab): McpPanelTab {
  return tab === "installed" ? "search" : "installed";
}

export interface UseMcpPanelOptions {
  mcpConfig: Record<string, McpServerConfig>;
  mcpStatus: Record<string, { status: string; error?: string }>;
  onMcpConfigChange(next: Record<string, McpServerConfig>): void;
  emit(item: Item): void;
}

export interface McpPanelController {
  isOpen: boolean;
  open(tab: McpPanelTab, query?: string): void;
  /** Keyboard state machine, slotted into App's modal precedence chain. */
  handler: ModalHandler;
  /** Data props for <McpPanel>; App adds theme/width. */
  panelProps: {
    tab: McpPanelTab;
    installedRows: InstalledMcpRow[];
    selectedInstalledIndex: number;
    query: string;
    results: CatalogServerSummary[];
    selectedSearchIndex: number;
    loading: boolean;
    error: string | null;
  };
}

/**
 * The /mcp control panel state machine: tabs, installed-server actions
 * (toggle/remove/reload), debounced catalog search and install. App keeps
 * only the open() call and the render slot.
 */
export function useMcpPanel(options: UseMcpPanelOptions): McpPanelController {
  const { mcpConfig, mcpStatus, onMcpConfigChange, emit } = options;
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<McpPanelTab>("installed");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogServerSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedInstalledIndex, setSelectedInstalledIndex] = useState(0);
  const [selectedSearchIndex, setSelectedSearchIndex] = useState(0);

  useEffect(() => {
    setSelectedInstalledIndex(0);
  }, [isOpen, tab, mcpConfig]);

  useEffect(() => {
    setSelectedSearchIndex(0);
  }, [isOpen, tab, query, results.length]);

  // Debounced live search against the official registry while the search tab
  // is open. Cancelled on every keystroke/unmount so stale responses never
  // overwrite newer ones.
  useEffect(() => {
    if (!isOpen || tab !== "search") return;
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      void new OfficialMcpRegistryCatalog()
        .search(trimmed)
        .then((result) => {
          if (cancelled) return;
          setResults(result.items);
          setLoading(false);
        })
        .catch((searchError) => {
          if (cancelled) return;
          setResults([]);
          setLoading(false);
          setError(searchError instanceof Error ? searchError.message : "failed to search MCP catalog");
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, tab, query]);

  const installedRows = buildInstalledMcpRows(mcpConfig, mcpStatus);

  const open = useCallback((nextTab: McpPanelTab, nextQuery = "") => {
    setIsOpen(true);
    setTab(nextTab);
    setQuery(nextQuery);
    setError(null);
    if (nextTab === "installed") {
      setResults([]);
      setLoading(false);
    }
  }, []);

  function toggleInstalledServer(name: string): void {
    const cfg = loadStoredConfig();
    const current = cfg.mcp?.[name];
    if (!current) return;
    const next = withMcpServer(cfg, name, {
      ...current,
      enabled: current.enabled === false ? true : false,
    });
    saveStoredConfig(next);
    onMcpConfigChange(next.mcp ?? {});
    emit({
      kind: "command",
      title: "MCP Updated",
      rows: [
        { label: "server", value: name },
        { label: "enabled", value: next.mcp?.[name]?.enabled === false ? "false" : "true" },
      ],
    });
  }

  function removeInstalledServer(name: string): void {
    const next = withoutMcpServer(loadStoredConfig(), name);
    saveStoredConfig(next);
    onMcpConfigChange(next.mcp ?? {});
    emit({
      kind: "command",
      title: "MCP Removed",
      rows: [{ label: "server", value: name }],
    });
  }

  const handler: ModalHandler = {
    active: isOpen,
    onInput(_in, key) {
      if (key.escape) {
        setIsOpen(false);
        setError(null);
        return true;
      }
      if (key.leftArrow || key.rightArrow || key.tab) {
        setTab(toggleTab);
        return true;
      }
      if (tab === "installed") {
        if (installedRows.length > 0 && key.downArrow) {
          setSelectedInstalledIndex((prev) => (prev + 1) % installedRows.length);
          return true;
        }
        if (installedRows.length > 0 && key.upArrow) {
          setSelectedInstalledIndex((prev) => (prev - 1 + installedRows.length) % installedRows.length);
          return true;
        }
        const selected = installedRows[selectedInstalledIndex];
        if (key.return && selected) {
          toggleInstalledServer(selected.name);
          return true;
        }
        if ((_in === "d" || _in === "D") && selected) {
          removeInstalledServer(selected.name);
          return true;
        }
        if (_in === "r" || _in === "R") {
          onMcpConfigChange(mcpConfig);
          emit({
            kind: "command",
            title: "MCP Reload",
            rows: [{ label: "status", value: "reloading configured MCP servers" }],
          });
        }
        return true;
      }
      // search tab
      if (results.length > 0 && key.downArrow) {
        setSelectedSearchIndex((prev) => (prev + 1) % results.length);
        return true;
      }
      if (results.length > 0 && key.upArrow) {
        setSelectedSearchIndex((prev) => (prev - 1 + results.length) % results.length);
        return true;
      }
      if (key.backspace || key.delete) {
        if (query.length > 0) setQuery((prev) => prev.slice(0, -1));
        return true;
      }
      if (key.return) {
        const selected = results[selectedSearchIndex];
        if (!selected) return true;
        setLoading(true);
        setError(null);
        void installCatalogServer(selected.name, onMcpConfigChange, emit)
          .then(() => {
            setLoading(false);
            setTab("installed");
            setQuery("");
          })
          .catch((installError) => {
            setLoading(false);
            setError(installError instanceof Error ? installError.message : "failed to add MCP server");
          });
        return true;
      }
      if (!key.ctrl && !key.meta && !key.return && _in) {
        setQuery((prev) => prev + _in);
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
      query,
      results,
      selectedSearchIndex,
      loading,
      error,
    },
  };
}
