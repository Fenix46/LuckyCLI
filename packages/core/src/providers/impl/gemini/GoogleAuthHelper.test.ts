import { describe, expect, it } from "vitest";
import { getBrowserOpenCommands } from "./GoogleAuthHelper.js";

describe("getBrowserOpenCommands", () => {
  it("uses open on macOS", () => {
    expect(getBrowserOpenCommands("darwin")).toEqual([{ command: "open", args: [] }]);
  });

  it("uses cmd start on Windows", () => {
    expect(getBrowserOpenCommands("win32")).toEqual([
      { command: "cmd", args: ["/c", "start", ""] },
    ]);
  });

  it("uses Linux desktop openers with fallbacks", () => {
    expect(getBrowserOpenCommands("linux").map((command) => command.command)).toEqual([
      "xdg-open",
      "gio",
      "gnome-open",
      "kde-open",
    ]);
  });

  it("prefers wslview on WSL", () => {
    expect(
      getBrowserOpenCommands("linux", { WSL_DISTRO_NAME: "Ubuntu" }).map(
        (command) => command.command,
      ),
    ).toEqual(["wslview", "xdg-open", "gio", "gnome-open", "kde-open"]);
  });
});
