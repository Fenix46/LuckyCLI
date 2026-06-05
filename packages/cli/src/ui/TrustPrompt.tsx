import { Box, Text } from "../vendor/ink-compat.js";
import React, { useState } from "react";
import { SelectList } from "./components/SelectList.js";
import {
  buildAndSaveGraph,
  loadStoredConfig,
  recordGraphBuilt,
  recordProjectTrust,
} from "@luckycli/core";
import { themeById } from "./themes.js";

interface TrustPromptProps {
  /** Absolute folder the agent is opening in. */
  cwd: string;
  /** Called once the trust (and optional build) flow is finished. */
  onDone: () => void;
}

type Step = "trust" | "graph" | "building" | "done";

/**
 * First-open gate for a folder. Asks the user to trust the project, then offers
 * to build the knowledge graph. The decision is persisted per-folder, so this
 * screen never appears again for the same path. Owns its own persistence so the
 * Root state machine only has to render it until `onDone`.
 */
export function TrustPrompt({ cwd, onDone }: TrustPromptProps): React.JSX.Element {
  const theme = themeById(loadStoredConfig().theme);
  const [step, setStep] = useState<Step>("trust");
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onTrust(value: string): void {
    if (value !== "yes") {
      recordProjectTrust(cwd, false);
      onDone();
      return;
    }
    recordProjectTrust(cwd, true);
    setStep("graph");
  }

  function onGraph(value: string): void {
    if (value !== "build") {
      onDone();
      return;
    }
    setStep("building");
    buildAndSaveGraph(cwd)
      .then((s) => {
        recordGraphBuilt(cwd);
        setSummary(`${s.nodeCount} nodes, ${s.edgeCount} edges from ${s.fileCount} files`);
        setStep("done");
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setStep("done");
      });
  }

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold color={theme.primary}>
        Welcome to this project
      </Text>
      <Text color={theme.muted}>{cwd}</Text>
      <Box marginTop={1} flexDirection="column">
        {step === "trust" && (
          <>
            <Text>
              Trust this folder? Lucky will read and operate on its files in this session.
            </Text>
            <Box marginTop={1}>
              <SelectList
                items={[
                  { label: "Yes, trust this folder", value: "yes" },
                  { label: "No", value: "no" },
                ]}
                onSelect={(item) => onTrust(String(item.value))}
              />
            </Box>
          </>
        )}

        {step === "graph" && (
          <>
            <Text>
              Build a knowledge graph of this project? It lets the agent navigate by
              querying instead of re-reading files — faster and cheaper in tokens.
            </Text>
            <Text color={theme.muted}>AST-only, no API cost. Saved in .lucky/graph/.</Text>
            <Box marginTop={1}>
              <SelectList
                items={[
                  { label: "Build the knowledge graph now (recommended)", value: "build" },
                  { label: "Skip for now (you can run /graph later)", value: "skip" },
                ]}
                onSelect={(item) => onGraph(String(item.value))}
              />
            </Box>
          </>
        )}

        {step === "building" && (
          <Text color={theme.accent}>Building the project graph… scanning files.</Text>
        )}

        {step === "done" && (
          <>
            {error ? (
              <Text color={theme.error}>Graph build failed: {error}</Text>
            ) : (
              <Text color={theme.success}>Graph built — {summary}.</Text>
            )}
            <Box marginTop={1}>
              <SelectList
                items={[{ label: "Continue", value: "continue" }]}
                onSelect={() => onDone()}
              />
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
}
