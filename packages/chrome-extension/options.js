const form = document.getElementById("form");
const portInput = document.getElementById("port");
const tokenInput = document.getElementById("token");
const status = document.getElementById("status");
const check = document.getElementById("check");

function setStatus(text, kind) {
  status.textContent = text;
  status.className = kind ?? "";
}

async function load() {
  const stored = await chrome.storage.local.get(["port", "token"]);
  if (stored.port) portInput.value = String(stored.port);
  if (stored.token) tokenInput.value = stored.token;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const port = Number(portInput.value);
  const token = tokenInput.value.trim();
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    setStatus("Port must be a number between 1 and 65535.", "err");
    return;
  }
  if (token.length < 16) {
    setStatus("Token looks too short; copy it from /browser.", "err");
    return;
  }
  await chrome.storage.local.set({ port, token });
  setStatus("Saved. The extension is reconnecting.", "ok");
});

check.addEventListener("click", async () => {
  setStatus("Checking…");
  const response = await chrome.runtime.sendMessage({ type: "lucky:check" });
  if (response?.ok) {
    const polls = response.info?.pollCount ?? 0;
    setStatus(`Connected to Lucky. ${polls} poll${polls === 1 ? "" : "s"} so far.`, "ok");
  } else {
    setStatus(response?.error ?? "Connection failed.", "err");
  }
});

void load();
