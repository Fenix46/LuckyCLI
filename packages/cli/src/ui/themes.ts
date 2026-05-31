export interface Theme {
  id: string;
  name: string;
  primary: string;
  success: string;
  accent: string;
  warning: string;
  muted: string;
  error: string;
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
  },
  { id: "minimal", name: "Legacy Monochrome", primary: "white", accent: "gray", success: "white", warning: "white", muted: "gray", error: "white" },
  { id: "matrix", name: "Digital Matrix (CRT)", primary: "#00ff00", accent: "#008f11", success: "#00ff00", warning: "#ffff00", muted: "#335533", error: "#ff5555" },
  { id: "amber", name: "DEC Amber Mainframe", primary: "#ffb000", accent: "#ff8000", success: "#ffd166", warning: "#ff4500", muted: "#806033", error: "#ff5555" },
];

export function themeById(id: string | undefined): Theme {
  return THEMES.find((theme) => theme.id === id) ?? (THEMES[0] as Theme);
}
