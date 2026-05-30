import crypto from "node:crypto";

export interface PkceCodes {
  verifier: string;
  challenge: string;
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function generatePKCE(): Promise<PkceCodes> {
  const verifier = base64UrlEncode(crypto.randomBytes(32));
  const challenge = base64UrlEncode(
    crypto.createHash("sha256").update(verifier).digest(),
  );
  return { verifier, challenge };
}

export function generateState(): string {
  return base64UrlEncode(crypto.randomBytes(32));
}
