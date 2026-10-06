import "server-only";
import { X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import { getEnv } from "@/config/env";
import type { StatusData } from "@/contracts/status";

/** Expiry of the certificate at TLS_CERT_PATH (Status page "TLS certificate"). */
export async function certificateState(now: Date): Promise<StatusData["server"]["tls"]> {
  const path = getEnv("observability").TLS_CERT_PATH;
  if (!path) return { state: "none" };
  try {
    const certificate = new X509Certificate(await readFile(path));
    const expiresAt = new Date(certificate.validTo);
    return { state: expiresAt.getTime() > now.getTime() ? "valid" : "expired", expiresAt: expiresAt.toISOString() };
  } catch {
    return { state: "unreadable" };
  }
}
