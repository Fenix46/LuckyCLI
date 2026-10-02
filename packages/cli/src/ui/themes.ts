export interface Theme {
  id: string;
  name: string;
  /** Brand color: the clover, the reply marker, the prompt chevron. */
  primary: string;
  success: string;
  /** Interactive/active color: running work, selections, file targets. */
  accent: string;
  warning: string;
  /** Secondary text: labels, summaries, hints. */
  muted: string;
  error: string;
  /** Body text. Used instead of hard-coded white so light themes stay legible. */
  text: string;
  /** Hairlines: idle borders, tree connectors, empty meter cells. */
  subtle: string;
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
    primary: "#3ddc97",
    accent: "#8fa3ff",
    success: "#56d364",
    warning: "#e3b341",
    muted: "#7d8590",
    error: "#ff7b72",
    text: "#d6dbe2",
    subtle: "#3a414c",
    userBg: "#1c222b",
    userFg: "#eef1f5",
    diffAddedBg: "#14301f",
    diffRemovedBg: "#3a1a1d",
    codeBlockBg: "#161b22",
    codeLabelBg: "#1f252e",
  },
  {
    id: "lucky-light",
    name: "Lucky Light",
    primary: "#0f8a5a",
    accent: "#4757d6",
    success: "#1a7f37",
    warning: "#9a6700",
    muted: "#656d76",
    error: "#cf222e",
    text: "#1f2328",
    subtle: "#d0d7de",
    userBg: "#eef1f4",
    userFg: "#1f2328",
    diffAddedBg: "#dafbe1",
    diffRemovedBg: "#ffebe9",
    codeBlockBg: "#f3f5f7",
    codeLabelBg: "#e7ebef",
  },
  {
    id: "terminal-dark",
    name: "Terminal Dark",
    primary: "#88c0d0",
    accent: "#b48ead",
    success: "#a3be8c",
    warning: "#ebcb8b",
    muted: "#7b8394",
    error: "#bf616a",
    text: "#e5e9f0",
    subtle: "#434c5e",
    userBg: "#3b4252",
    userFg: "#eceff4",
    diffAddedBg: "#2e4238",
    diffRemovedBg: "#4a3038",
    codeBlockBg: "#26282c",
    codeLabelBg: "#2e3238",
  },
  {
    id: "terminal-ansi",
    name: "ANSI Portable",
    primary: "green",
    accent: "cyan",
    success: "green",
    warning: "yellow",
    muted: "gray",
    error: "redBright",
    text: "white",
    subtle: "gray",
    userBg: "blackBright",
    userFg: "white",
    diffAddedBg: "green",
    diffRemovedBg: "red",
    codeBlockBg: "blackBright",
    codeLabelBg: "blackBright",
  },
  {
    id: "daltonized-dark",
    name: "Daltonized Dark",
    primary: "#f0c75e",
    accent: "#6aa7ff",
    success: "#56b4e9",
    warning: "#e69f00",
    muted: "#848c9c",
    error: "#ff7f7f",
    text: "#e6ebf5",
    subtle: "#3a4458",
    userBg: "#2b3a55",
    userFg: "#f0f4ff",
    diffAddedBg: "#1d3a52",
    diffRemovedBg: "#52301d",
    codeBlockBg: "#222b38",
    codeLabelBg: "#2a3546",
  },
  { id: "minimal", name: "Legacy Monochrome", primary: "white", accent: "white", success: "white", warning: "white", muted: "gray", error: "white", text: "white", subtle: "gray", userBg: "blackBright", userFg: "white", diffAddedBg: "green", diffRemovedBg: "red", codeBlockBg: "blackBright", codeLabelBg: "blackBright" },
  { id: "matrix", name: "Digital Matrix (CRT)", primary: "#00ff00", accent: "#00c832", success: "#00ff00", warning: "#ffff00", muted: "#3f8f3f", error: "#ff5555", text: "#aaffaa", subtle: "#1f4d1f", userBg: "#013220", userFg: "#aaffaa", diffAddedBg: "#014421", diffRemovedBg: "#441111", codeBlockBg: "#001a00", codeLabelBg: "#002400" },
  { id: "amber", name: "DEC Amber Mainframe", primary: "#ffb000", accent: "#ff8000", success: "#ffd166", warning: "#ff4500", muted: "#a07a40", error: "#ff5555", text: "#ffd9a0", subtle: "#5a3f12", userBg: "#33220a", userFg: "#ffd9a0", diffAddedBg: "#2e3300", diffRemovedBg: "#441b0a", codeBlockBg: "#1a1000", codeLabelBg: "#241800" },
];

export function themeById(id: string | undefined): Theme {
  return THEMES.find((theme) => theme.id === id) ?? (THEMES[0] as Theme);
}
