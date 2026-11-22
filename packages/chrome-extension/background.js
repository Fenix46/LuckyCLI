// Lucky Chrome bridge client.
//
// The CLI runs a loopback HTTP server (see packages/cli/src/browser/bridge.ts).
// This worker long-polls GET /next for one command at a time, executes it with
// chrome APIs, then POSTs /result. The port and bearer token come from the
// options page and live in chrome.storage.local.

const RETRY_MS = 1500;

let polling = false;
let generation = 0;
let controller = null;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("lucky-reconnect", { periodInMinutes: 1 });
  restartPolling();
});

chrome.runtime.onStartup.addListener(() => {
  restartPolling();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "lucky-reconnect") restartPolling();
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.port || changes.token) restartPolling();
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "lucky:check") {
    void checkConnection().then(sendResponse);
    return true;
  }
  if (message?.type === "lucky:status") {
    sendResponse({ polling });
    return false;
  }
  return false;
});

async function readConfig() {
  const stored = await chrome.storage.local.get(["port", "token"]);
  const port = Number(stored.port);
  const token = typeof stored.token === "string" ? stored.token.trim() : "";
  if (!Number.isInteger(port) || port <= 0 || port > 65535 || !token) return null;
  return { port, token, base: `http://127.0.0.1:${port}` };
}

async function checkConnection() {
  const config = await readConfig();
  if (!config) return { ok: false, error: "Set the port and token first." };
  try {
    const response = await fetch(`${config.base}/info`, {
      headers: { authorization: `Bearer ${config.token}` },
    });
    if (response.status === 401) return { ok: false, error: "Token rejected by Lucky." };
    if (!response.ok) return { ok: false, error: `Bridge answered HTTP ${response.status}.` };
    return { ok: true, info: await response.json() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function restartPolling() {
  generation += 1;
  polling = false;
  if (controller) controller.abort();
  controller = null;
  void startPolling();
}

async function startPolling() {
  if (polling) return;
  const run = generation;
  const config = await readConfig();
  if (!config) return;
  polling = true;
  controller = new AbortController();
  const { signal } = controller;
  try {
    while (run === generation && !signal.aborted) {
      let command;
      try {
        command = await nextCommand(config, signal);
      } catch (error) {
        if (signal.aborted) break;
        await sleep(RETRY_MS);
        continue;
      }
      if (!command) continue;
      const payload = await runCommand(command);
      try {
        await postResult(config, payload, signal);
      } catch {
        // The CLI may have restarted; the next poll reconnects.
      }
    }
  } finally {
    if (run === generation) {
      polling = false;
      controller = null;
    }
  }
}

async function nextCommand(config, signal) {
  // The bridge ends an idle long poll with 204 after ~25s, so this fetch
  // always settles; the signal only cancels it when settings change.
  const response = await fetch(`${config.base}/next`, {
    headers: { authorization: `Bearer ${config.token}` },
    signal,
  });
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(`bridge answered HTTP ${response.status}`);
  return await response.json();
}

async function postResult(config, payload, signal) {
  await fetch(`${config.base}/result`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
    signal,
  });
}

async function runCommand(command) {
  try {
    const result = await execute(command);
    return { id: command.id, result };
  } catch (error) {
    return { id: command.id, error: error instanceof Error ? error.message : String(error) };
  }
}

async function execute(command) {
  const params = command.params ?? {};
  switch (command.method) {
    case "tabs.list":
      return (await chrome.tabs.query({})).map(summarizeTab);
    case "tabs.open": {
      if (typeof params.url !== "string") throw new Error("tabs.open needs a url.");
      const tab = await chrome.tabs.create({ url: params.url, active: true });
      return summarizeTab(tab);
    }
    case "tabs.activate": {
      const tab = await requireTab(params.tabId);
      await chrome.tabs.update(tab.id, { active: true });
      if (tab.windowId !== undefined) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
      return `Activated tab ${tab.id}${tab.title ? ` (${tab.title})` : ""}.`;
    }
    case "tabs.close": {
      const tab = await requireTab(params.tabId);
      await chrome.tabs.remove(tab.id);
      return `Closed tab ${tab.id}${tab.title ? ` (${tab.title})` : ""}.`;
    }
    case "page.snapshot":
      return pageSnapshot(params.tabId);
    case "page.click":
      return pageClick(params.tabId, params.selector);
    case "page.type":
      return pageType(params.tabId, params.selector, params.text, params.submit !== false);
    default:
      throw new Error(`Unknown Lucky method "${command.method}".`);
  }
}

function summarizeTab(tab) {
  return {
    id: tab.id,
    title: tab.title ?? "",
    url: tab.url ?? "",
    active: Boolean(tab.active),
    pinned: Boolean(tab.pinned),
    windowId: tab.windowId,
  };
}

async function requireTab(tabId) {
  if (Number.isInteger(tabId)) {
    const tab = await chrome.tabs.get(tabId);
    if (!tab) throw new Error(`No tab ${tabId}.`);
    return tab;
  }
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!active) throw new Error("No active tab in the last focused window.");
  return active;
}

async function inject(tabId, func, args) {
  const tab = await requireTab(tabId);
  const [entry] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func,
    args: args ?? [],
  });
  if (!entry) throw new Error("The page returned no result.");
  if (entry.error) throw new Error(String(entry.error));
  return entry.result;
}

async function pageSnapshot(tabId) {
  return inject(
    tabId,
    () => ({
      title: document.title,
      url: location.href,
      text: (document.body?.innerText ?? "").slice(0, 20000),
    }),
    [],
  );
}

async function pageClick(tabId, selector) {
  if (typeof selector !== "string" || !selector) throw new Error("page.click needs a selector.");
  return inject(
    tabId,
    (query) => {
      const element = document.querySelector(query);
      if (!element) throw new Error(`No element matches ${query}.`);
      element.scrollIntoView({ block: "center", inline: "center" });
      if (typeof element.click === "function") {
        element.click();
      } else {
        element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      }
      return `Clicked ${query}.`;
    },
    [selector],
  );
}

async function pageType(tabId, selector, text, submit) {
  if (typeof selector !== "string" || !selector) throw new Error("page.type needs a selector.");
  if (typeof text !== "string") throw new Error("page.type needs text.");
  return inject(
    tabId,
    (query, value, shouldSubmit) => {
      const element = document.querySelector(query);
      if (!element) throw new Error(`No element matches ${query}.`);
      element.focus();
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        const prototype =
          element instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
        if (setter) setter.call(element, value);
        else element.value = value;
      } else if (element.isContentEditable) {
        element.textContent = value;
      } else {
        throw new Error(`${query} is not an input, textarea or contenteditable element.`);
      }
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      if (shouldSubmit) {
        const form = element.form;
        if (form && typeof form.requestSubmit === "function") {
          form.requestSubmit();
        } else {
          element.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }),
          );
        }
      }
      return `Typed ${value.length} characters into ${query}.`;
    },
    [selector, text, submit],
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
