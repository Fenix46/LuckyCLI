/**
 * Trust an HTTP Toolkit (or NODE_EXTRA_CA_CERTS) CA when a local debugging proxy
 * is configured, so the ChatGPT backend calls can be inspected during dev. No-op
 * unless https_proxy points at a localhost:8000 proxy. Shared by every ChatGPT
 * backend call (usage, models, …) so the CA is loaded in exactly one place.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as tls from "node:tls";

let loaded = false;

export function ensureChatGptCa(): void {
  if (loaded) return;
  loaded = true;

  const proxy = process.env.https_proxy ?? process.env.HTTPS_PROXY ?? "";
  if (!/https?:\/\/(127\.0\.0\.1|localhost):8000\b/.test(proxy)) return;

  const httpToolkitCa = join(homedir(), "Library", "Preferences", "httptoolkit", "ca.pem");
  const extraCaPaths = [
    ...(process.env.NODE_EXTRA_CA_CERTS ? [process.env.NODE_EXTRA_CA_CERTS] : []),
    httpToolkitCa,
  ];
  const extraCerts = extraCaPaths
    .filter((path) => existsSync(path))
    .map((path) => readFileSync(path, "utf8"));

  if (!extraCerts.length || !tls.setDefaultCACertificates || !tls.getCACertificates) return;
  tls.setDefaultCACertificates([...tls.getCACertificates("default"), ...extraCerts]);
}
