/** Friendly rewriting for provider error messages surfaced in the transcript. */
export function humanizeError(message: string): string {
  if (!message.includes("Code Assist request failed")) return message;

  const statusMatch = message.match(/Code Assist request failed \((\d+)\)/);
  const resetMatch = message.match(/reset after\s+(\d+s)/i);
  const modelMatch = message.match(/"model":"([^"]+)"/);
  const status = statusMatch?.[1];

  if (status === "429") {
    return [
      "Code Assist quota exhausted",
      modelMatch ? `for ${modelMatch[1]}` : "",
      resetMatch ? `retry in ${resetMatch[1]}` : "",
    ].filter(Boolean).join(" | ");
  }

  return message;
}
