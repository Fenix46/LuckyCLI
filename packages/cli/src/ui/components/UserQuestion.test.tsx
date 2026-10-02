import React from "react";
import { describe, expect, it } from "vitest";
import { renderToScreen, scanPositions } from "../../vendor/ink/render-to-screen.js";
import { THEMES, type Theme } from "../themes.js";
import type { UserQuestionRequest } from "../lib/requests.js";
import { UserQuestionRequestView } from "./UserQuestion.js";

const theme = THEMES[0] as Theme;

function request(overrides: Partial<UserQuestionRequest> = {}): UserQuestionRequest {
  return { question: "Which db?", options: ["sqlite", "postgres"], resolve: () => {}, ...overrides };
}

describe("UserQuestionRequestView", () => {
  it("points at the selected option and offers a typed answer", () => {
    const { screen } = renderToScreen(
      <UserQuestionRequestView theme={theme} request={request()} selectedIndex={1} typing={false} width={80} />,
      80,
    );
    expect(scanPositions(screen, "Which db?")).toHaveLength(1);
    expect(scanPositions(screen, "❯ postgres")).toHaveLength(1);
    expect(scanPositions(screen, "your own answer")).toHaveLength(1);
  });

  it("offers a typed answer even when the model disallowed free text", () => {
    const { screen } = renderToScreen(
      <UserQuestionRequestView
        theme={theme}
        request={request({ allowFreeText: false })}
        selectedIndex={0}
        typing={false}
        width={80}
      />,
      80,
    );
    expect(scanPositions(screen, "your own answer")).toHaveLength(1);
  });

  it("drops the option cursor while a typed answer is pending", () => {
    const { screen } = renderToScreen(
      <UserQuestionRequestView theme={theme} request={request()} selectedIndex={1} typing={true} width={80} />,
      80,
    );
    expect(scanPositions(screen, "❯")).toHaveLength(0);
    expect(scanPositions(screen, "send")).toHaveLength(1);
  });
});
