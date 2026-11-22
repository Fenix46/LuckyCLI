import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BrowserBridge } from "./bridge.js";

const ORIGINAL_HOME = process.env.HOME;

interface Command {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

describe("BrowserBridge", () => {
  let bridge: BrowserBridge;
  let home: string;
  let base: string;
  let token: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "lucky-bridge-"));
    process.env.HOME = home;
    bridge = new BrowserBridge();
    const info = await bridge.info();
    base = `http://127.0.0.1:${info.port}`;
    token = info.token;
  });

  afterEach(async () => {
    await bridge.close();
    process.env.HOME = ORIGINAL_HOME;
    await rm(home, { recursive: true, force: true });
  });

  const headers = () => ({ authorization: `Bearer ${token}` });

  it("writes a private info file and reports a live status", async () => {
    const path = join(home, ".lucky", "browser.json");
    const stored = JSON.parse(await readFile(path, "utf8")) as { port: number; token: string };
    expect(stored).toEqual({ port: Number(base.split(":")[2]), token });
    expect((await stat(path)).mode & 0o777).toBe(0o600);

    const response = await fetch(`${base}/info`, { headers: headers() });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, pending: 0 });
  });

  it("rejects requests without the bearer token", async () => {
    expect((await fetch(`${base}/next`)).status).toBe(401);
    expect(
      (await fetch(`${base}/next`, { headers: { authorization: "Bearer nope" } })).status,
    ).toBe(401);
  });

  it("hands a queued command to the extension and accepts its result", async () => {
    const pending = bridge.request("tabs.list");
    const next = await fetch(`${base}/next`, { headers: headers() });
    expect(next.status).toBe(200);
    const command = (await next.json()) as Command;
    expect(command.method).toBe("tabs.list");

    const posted = await fetch(`${base}/result`, {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify({ id: command.id, result: [{ id: 1, title: "Tab" }] }),
    });
    expect(posted.status).toBe(200);
    await expect(pending).resolves.toEqual([{ id: 1, title: "Tab" }]);
  });

  it("reports an extension-side error", async () => {
    const pending = bridge.request("page.click", { selector: "#missing" });
    const assertion = expect(pending).rejects.toThrow(/No element/);
    const command = (await (
      await fetch(`${base}/next`, { headers: headers() })
    ).json()) as Command;
    await fetch(`${base}/result`, {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify({ id: command.id, error: "No element matches #missing" }),
    });
    await assertion;
  });

  it("rejects a command the extension never answers", async () => {
    await expect(bridge.request("tabs.list", {}, 50)).rejects.toThrow(/did not answer/);
  });

  it("rejects pending commands when closed", async () => {
    const pending = bridge.request("tabs.list");
    const assertion = expect(pending).rejects.toThrow(/closed/);
    await bridge.close();
    await assertion;
  });
});
