import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { defineTool } from "../types.js";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 4 * 1024 * 1024;
const MAX_TREE_CHARS = 20_000;

const KEY_CODES: Record<string, number> = {
  return: 36,
  enter: 36,
  tab: 48,
  space: 49,
  delete: 51,
  backspace: 51,
  escape: 53,
  esc: 53,
  left: 123,
  right: 124,
  down: 125,
  up: 126,
  home: 115,
  end: 119,
  pageup: 116,
  pagedown: 121,
  f1: 122,
  f2: 120,
  f3: 99,
  f4: 118,
  f5: 96,
  f6: 97,
  f7: 98,
  f8: 100,
  f9: 101,
  f10: 109,
  f11: 103,
  f12: 111,
};

const MODIFIER_NAMES = {
  command: "command down",
  shift: "shift down",
  option: "option down",
  control: "control down",
} as const;

type Modifier = keyof typeof MODIFIER_NAMES;

export interface ComputerDeps {
  platform?: NodeJS.Platform;
  cwd: string;
  runAppleScript: (script: string) => Promise<string>;
  screenshot: (absolutePath: string) => Promise<void>;
}

export interface ComputerInput {
  action: "list_apps" | "list_windows" | "ui_tree" | "click" | "type" | "key" | "screenshot";
  app?: string;
  x?: number;
  y?: number;
  text?: string;
  key?: string;
  modifiers?: Modifier[];
}

/**
 * Run one macOS accessibility action. Kept separate from the tool so tests can
 * exercise the generated AppleScript and key mapping with a fake runner.
 */
export async function runComputerAction(input: ComputerInput, deps: ComputerDeps): Promise<string> {
  const platform = deps.platform ?? process.platform;
  if (platform !== "darwin") {
    throw new Error("Computer use is currently implemented for macOS only.");
  }
  switch (input.action) {
    case "list_apps": {
      const out = await deps.runAppleScript(
        'tell application "System Events" to get name of every process whose background only is false',
      );
      return out.trim() || "(no visible applications)";
    }
    case "list_windows": {
      requireApp(input);
      const out = await deps.runAppleScript(
        `tell application "System Events" to tell process ${appleScriptString(input.app)} to get name of every window`,
      );
      return out.trim() || "(no windows)";
    }
    case "ui_tree": {
      requireApp(input);
      const out = await deps.runAppleScript(uiTreeScript(input.app));
      return out.slice(0, MAX_TREE_CHARS);
    }
    case "click": {
      if (input.x === undefined || input.y === undefined) {
        throw new Error("click needs x and y.");
      }
      await deps.runAppleScript(
        `tell application "System Events" to click at {${Math.round(input.x)}, ${Math.round(input.y)}}`,
      );
      return `Clicked at ${Math.round(input.x)}, ${Math.round(input.y)}.`;
    }
    case "type": {
      if (input.text === undefined) throw new Error("type needs text.");
      await deps.runAppleScript(
        `tell application "System Events" to keystroke ${appleScriptString(input.text)}${usingClause(input.modifiers)}`,
      );
      return `Typed ${input.text.length} characters.`;
    }
    case "key": {
      if (!input.key) throw new Error("key needs a key name or character.");
      await deps.runAppleScript(keyScript(input.key, input.modifiers));
      return `Pressed ${input.key}.`;
    }
    case "screenshot": {
      const dir = join(deps.cwd, ".lucky", "screenshots");
      await mkdir(dir, { recursive: true });
      const absolute = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
      await deps.screenshot(absolute);
      return `Screenshot saved to ${relative(deps.cwd, absolute)}.`;
    }
  }
}

export const computerTool = defineTool({
  name: "computer",
  description:
    "Control macOS through Accessibility (System Events): list visible apps, list " +
    "an app's windows, read a text UI tree, click coordinates, type text, press a " +
    "key, or save a screenshot. Requires Accessibility permission for the terminal " +
    "running Lucky. Prefer a dedicated app/CLI integration when one exists.",
  schema: z.object({
    action: z.enum(["list_apps", "list_windows", "ui_tree", "click", "type", "key", "screenshot"]),
    app: z.string().optional().describe("Application name for list_windows/ui_tree."),
    x: z.number().optional().describe("Screen x coordinate for click."),
    y: z.number().optional().describe("Screen y coordinate for click."),
    text: z.string().optional().describe("Text to type."),
    key: z.string().optional().describe("Key name (return, tab, escape, f1, ...) or one character."),
    modifiers: z
      .array(z.enum(["command", "shift", "option", "control"]))
      .optional()
      .describe("Modifiers held while typing or pressing a key."),
  }),
  async execute(input, ctx) {
    try {
      const out = await runComputerAction(
        {
          action: input.action,
          ...(input.app !== undefined ? { app: input.app } : {}),
          ...(input.x !== undefined ? { x: input.x } : {}),
          ...(input.y !== undefined ? { y: input.y } : {}),
          ...(input.text !== undefined ? { text: input.text } : {}),
          ...(input.key !== undefined ? { key: input.key } : {}),
          ...(input.modifiers !== undefined ? { modifiers: input.modifiers } : {}),
        },
        {
          cwd: ctx.cwd,
          runAppleScript: (script) => runAppleScript(script),
          screenshot: (path) => screenshot(path),
        },
      );
      return { content: out };
    } catch (error) {
      return {
        content: `Computer use failed: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
  },
});

async function runAppleScript(script: string): Promise<string> {
  const { stdout } = await execFileAsync("osascript", ["-e", script], {
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
  });
  return stdout.trim();
}

async function screenshot(path: string): Promise<void> {
  await execFileAsync("screencapture", ["-x", path], {
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
  });
}

function requireApp(input: ComputerInput): asserts input is ComputerInput & { app: string } {
  if (!input.app) throw new Error(`${input.action} needs an app name.`);
}

function keyScript(key: string, modifiers: Modifier[] | undefined): string {
  const base = `tell application "System Events" to `;
  if (key.length === 1) {
    return `${base}keystroke ${appleScriptString(key)}${usingClause(modifiers)}`;
  }
  const code = KEY_CODES[key.toLowerCase()];
  if (code === undefined) {
    throw new Error(`Unknown key "${key}". Use one character or a name such as return, tab, escape, left, f1.`);
  }
  return `${base}key code ${code}${usingClause(modifiers)}`;
}

function usingClause(modifiers: Modifier[] | undefined): string {
  if (!modifiers || modifiers.length === 0) return "";
  return ` using {${modifiers.map((modifier) => MODIFIER_NAMES[modifier]).join(", ")}}`;
}

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n")}"`;
}

function uiTreeScript(app: string): string {
  const name = JSON.stringify(app);
  return `ObjC.import('Foundation');
const se = Application('System Events');
const proc = se.processes.byName(${name});
const win = proc.windows[0];
const out = [];
function walk(el, depth) {
  if (!el || out.length >= 250 || depth > 8) return;
  let role = '', name = '', value = '', x = null, y = null;
  try { role = String(el.role()); } catch (e) {}
  try { name = String(el.name()); } catch (e) {}
  try { value = String(el.value()); } catch (e) {}
  try { const p = el.position(); x = p[0]; y = p[1]; } catch (e) {}
  out.push({ role, name, value: value.slice(0, 200), x, y });
  let children = [];
  try { children = el.uiElements(); } catch (e) {}
  for (const child of children) walk(child, depth + 1);
}
walk(win, 0);
JSON.stringify(out);`;
}
