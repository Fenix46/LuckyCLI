import React from "react";
import { writeFileSync } from "fs";
import render from "./src/vendor/ink/root.js";
import { AlternateScreen } from "./src/vendor/ink/components/AlternateScreen.js";
import VendorBox from "./src/vendor/ink/components/Box.js";
import { IntroBanner } from "./src/ui/components/IntroBanner.js";
import { THEMES } from "./src/ui/themes.js";

const COLS = 290;
const ROWS = 68;
Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
Object.defineProperty(process.stdout, "columns", { value: COLS, configurable: true });
Object.defineProperty(process.stdout, "rows", { value: ROWS, configurable: true });

const theme = THEMES[0]!;
let maxLineWidth = 0;
const realWrite = process.stdout.write.bind(process.stdout);
(process.stdout as any).write = (c: any, ...r: any[]) => {
  const s = typeof c === "string" ? c : c?.toString?.() ?? "";
  if (s.length > 200) {
    for (const line of s.split("\n")) {
      const visible = line.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, "");
      if (visible.length > maxLineWidth) maxLineWidth = visible.length;
    }
  }
  return realWrite(c, ...r);
};

function App(): React.ReactElement {
  return (
    <AlternateScreen mouseTracking={false}>
      <VendorBox flexDirection="column" flexGrow={1} width="100%" paddingX={1}>
        <IntroBanner theme={theme} provider="openai" model="gpt-5.4-mini" />
      </VendorBox>
    </AlternateScreen>
  );
}

const instance = await render(<App />);
setTimeout(() => {
  instance.unmount();
  (process.stdout as any).write = realWrite;
  writeFileSync(
    "/tmp/lucky-overflow.txt",
    `terminal=${COLS} cols, widest line = ${maxLineWidth} visible chars\n${maxLineWidth > COLS ? "EXCEEDS WIDTH" : "within width"}\n`,
  );
  process.exit(0);
}, 400);
