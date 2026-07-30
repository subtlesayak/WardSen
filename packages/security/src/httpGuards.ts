import type { FastifyRequest } from "fastify";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const TRUSTED_DESKTOP_ORIGIN_HOSTS = new Set(["localhost", "tauri.localhost"]);

export function isLocalRequest(request: FastifyRequest): boolean {
  const host = request.headers.host?.split(":")[0]?.toLowerCase();
  const remote = request.ip?.replace("::ffff:", "");
  return Boolean(host && LOCAL_HOSTS.has(host) && (!remote || LOCAL_HOSTS.has(remote) || remote === "127.0.0.1"));
}

export function assertSameOrigin(request: FastifyRequest): void {
  const origin = request.headers.origin;
  if (!origin) return;
  const host = request.headers.host;
  if (!host) throw new Error("Missing host header");
  const parsed = new URL(origin);
  if (isTrustedDesktopOrigin(parsed)) return;
  if (parsed.host !== host) {
    throw new Error(
      `Cross-origin request blocked: received Origin ${origin}, but WardSen only accepts state-changing requests from http://${host} or the packaged desktop app. Open WardSen through its local URL instead of another site or proxy.`
    );
  }
}

function isTrustedDesktopOrigin(origin: URL): boolean {
  return (origin.protocol === "tauri:" || origin.hostname === "tauri.localhost") && TRUSTED_DESKTOP_ORIGIN_HOSTS.has(origin.hostname);
}
