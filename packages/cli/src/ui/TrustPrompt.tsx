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

type Step = "choose" | "building" | "failed";

// How long the "graph built" line stays up before the session opens.
const BUILT_PAUSE_MS = 900;

/**
 * First-open gate for a folder: one choice covers both trusting the project
 * and building its knowledge graph (recommended), so the user is one keypress
 * from the chat. The decision is persisted per-folder, so this screen never
 * appears again for the same path. A successful build continues on its own;
 * a failed one shows the error and waits.
 */
export function TrustPrompt({ cwd, onDone }: TrustPromptProps): React.JSX.Element {
  const theme = themeById(loadStoredConfig().theme);
  const [step, setStep] = useState<Step>("choose");
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onChoose(value: string): void {
    if (value === "no") {
      recordProjectTrust(cwd, false);
      onDone();
      return;
    }
    recordProjectTrust(cwd, true);
    if (value !== "build") {
      onDone();
      return;
    }
    setStep("building");
    buildAndSaveGraph(cwd)
      .then((s) => {
        recordGraphBuilt(cwd);
        setSummary(`${s.nodeCount} nodes, ${s.edgeCount} edges from ${s.fileCount} files`);
        setTimeout(onDone, BUILT_PAUSE_MS);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setStep("failed");
      });
  }

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold color={theme.primary}>
        Welcome to this project
      </Text>
      <Text color={theme.muted}>{cwd}</Text>
      <Box marginTop={1} flexDirection="column">
        {step === "choose" && (
          <>
            <Text>Lucky will read and operate on the files in this folder.</Text>
            <Text color={theme.muted}>
              The knowledge graph lets it navigate by querying instead of re-reading files — faster and
              cheaper in tokens. AST-only, no API cost, saved in .lucky/graph/.
            </Text>
            <Box marginTop={1}>
              <SelectList
                items={[
                  { label: "Trust this folder and build the knowledge graph (recommended)", value: "build" },
                  { label: "Trust this folder, skip the graph (run /graph later)", value: "trust" },
                  { label: "Don't trust this folder", value: "no" },
                ]}
                onSelect={(item) => onChoose(String(item.value))}
                theme={theme}
              />
            </Box>
          </>
        )}

        {step === "building" &&
          (summary ? (
            <Text color={theme.success}>Graph built — {summary}. Opening the session…</Text>
          ) : (
            <Text color={theme.accent}>Building the project graph… scanning files.</Text>
          ))}

        {step === "failed" && (
          <>
            <Text color={theme.error}>Graph build failed: {error}</Text>
            <Text color={theme.muted}>The folder is trusted; you can retry with /graph.</Text>
            <Box marginTop={1}>
              <SelectList
                items={[{ label: "Continue", value: "continue" }]}
                onSelect={() => onDone()}
                theme={theme}
              />
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
}
