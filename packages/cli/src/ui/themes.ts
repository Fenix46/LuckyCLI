export interface Theme {
  id: string;
  name: string;
  primary: string;
  success: string;
  accent: string;
  warning: string;
  muted: string;
  error: string;
  /** Background of sent user messages in the transcript. */
  userBg: string;
  /** Foreground of sent user messages in the transcript. */
  userFg: string;
  /** Background of added lines in diff views. */
  diffAddedBg: string;
  /** Background of removed lines in diff views. */
  diffRemovedBg: string;
  /** Background of assistant code blocks. */
  codeBlockBg: string;
  /** Background of the language label inside code blocks. */
  codeLabelBg: string;
}

export const THEMES: Theme[] = [
  {
    id: "lucky-dark",
    name: "Lucky Dark",
    primary: "#d77757",
    accent: "#8aa4ff",
    success: "#6bd17b",
    warning: "#d9a441",
    muted: "#6f7787",
    error: "#ff6b7a",
    userBg: "#223246",
    userFg: "#f2f5f8",
    diffAddedBg: "#1e3a2a",
    diffRemovedBg: "#4a1f28",
    codeBlockBg: "#1a1c20",
    codeLabelBg: "#141619",
  },
  {
    id: "lucky-light",
    name: "Lucky Light",
    primary: "#a94f35",
    accent: "#3f63d8",
    success: "#2f7d42",
    warning: "#8a641c",
    muted: "#6b7280",
    error: "#b4233f",
    userBg: "#dbe4f0",
    userFg: "#1c2430",
    diffAddedBg: "#d6f0dc",
    diffRemovedBg: "#f5d9dd",
    codeBlockBg: "#f0f0f0",
    codeLabelBg: "#e6e8ec",
  },
  {
    id: "terminal-dark",
    name: "Terminal Dark",
    primary: "#88c0d0",
    accent: "#b48ead",
    success: "#a3be8c",
    warning: "#ebcb8b",
    muted: "#667085",
    error: "#bf616a",
    userBg: "#3b4252",
    userFg: "#eceff4",
    diffAddedBg: "#2e4238",
    diffRemovedBg: "#4a3038",
    codeBlockBg: "#26282c",
    codeLabelBg: "#202226",
  },
  {
    id: "terminal-ansi",
    name: "ANSI Portable",
    primary: "cyan",
    accent: "blueBright",
    success: "green",
    warning: "yellow",
    muted: "gray",
    error: "redBright",
    userBg: "blackBright",
    userFg: "white",
    diffAddedBg: "green",
    diffRemovedBg: "red",
    codeBlockBg: "gray",
    codeLabelBg: "#4a4a4a",
  },
  {
    id: "daltonized-dark",
    name: "Daltonized Dark",
    primary: "#f0c75e",
    accent: "#6aa7ff",
    success: "#56b4e9",
    warning: "#e69f00",
    muted: "#7f8797",
    error: "#ff7f7f",
    userBg: "#2b3a55",
    userFg: "#f0f4ff",
    diffAddedBg: "#1d3a52",
    diffRemovedBg: "#52301d",
    codeBlockBg: "#222b38",
    codeLabelBg: "#1a2230",
  },
  { id: "minimal", name: "Legacy Monochrome", primary: "white", accent: "gray", success: "white", warning: "white", muted: "gray", error: "white", userBg: "blackBright", userFg: "white", diffAddedBg: "green", diffRemovedBg: "red", codeBlockBg: "blackBright", codeLabelBg: "gray" },
  { id: "matrix", name: "Digital Matrix (CRT)", primary: "#00ff00", accent: "#008f11", success: "#00ff00", warning: "#ffff00", muted: "#335533", error: "#ff5555", userBg: "#013220", userFg: "#aaffaa", diffAddedBg: "#014421", diffRemovedBg: "#441111", codeBlockBg: "#001a00", codeLabelBg: "#001000" },
  { id: "amber", name: "DEC Amber Mainframe", primary: "#ffb000", accent: "#ff8000", success: "#ffd166", warning: "#ff4500", muted: "#806033", error: "#ff5555", userBg: "#33220a", userFg: "#ffd9a0", diffAddedBg: "#2e3300", diffRemovedBg: "#441b0a", codeBlockBg: "#1a1000", codeLabelBg: "#120c00" },
];

export function themeById(id: string | undefined): Theme {
  return THEMES.find((theme) => theme.id === id) ?? (THEMES[0] as Theme);
}
