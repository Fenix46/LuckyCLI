import React, { useContext } from "react";
import render from "./src/vendor/ink/root.js";
import { AlternateScreen } from "./src/vendor/ink/components/AlternateScreen.js";
import VendorBox from "./src/vendor/ink/components/Box.js";
import VendorText from "./src/vendor/ink/components/Text.js";
import { TerminalSizeContext } from "./src/vendor/ink/components/TerminalSizeContext.js";

Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
Object.defineProperty(process.stdout, "columns", { value: 100, configurable: true });
Object.defineProperty(process.stdout, "rows", { value: 30, configurable: true });

function Probe(): React.ReactElement {
  const ctx = useContext(TerminalSizeContext);
  return (
    <VendorBox>
      <VendorText>CTX={JSON.stringify(ctx)}</VendorText>
    </VendorBox>
  );
}

let captured = "";
const realWrite = process.stdout.write.bind(process.stdout);
(process.stdout as any).write = (c: any, ...r: any[]) => {
  const s = typeof c === "string" ? c : c?.toString?.() ?? "";
  const m = s.match(/CTX=\{[^}]*\}/);
  if (m) captured = m[0];
  return realWrite(c, ...r);
};

const instance = await render(
  <AlternateScreen mouseTracking={false}>
    <Probe />
  </AlternateScreen>,
);
setTimeout(() => {
  instance.unmount();
  (process.stdout as any).write = realWrite;
  console.error("INITIAL " + captured);
  process.exit(0);
}, 300);
