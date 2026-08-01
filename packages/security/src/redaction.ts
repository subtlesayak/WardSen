const SECRET_PATTERN = /((?:"?(?:accessPassword|masterPassword|password|token|secret|session|key|totp)"?\s*[:=]\s*))(["']?)([^"',;}\s]+)\2/gi;
const ANSI_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const BITWARDEN_HIDDEN_PROMPT_PATTERN = /Master password:\s*\[[^\]]+\]\s+is hidden/gi;

export function redactSecrets(value: string, extraSecrets: string[] = []): string {
  let redacted = normalizeCliOutput(redactLocalPaths(value))
    .replace(BITWARDEN_HIDDEN_PROMPT_PATTERN, "Master password: [REDACTED]")
    .replace(SECRET_PATTERN, (_match, prefix: string, quote: string) => `${prefix}${quote}[REDACTED]${quote}`)
    .replace(/Master password:\s*\[REDACTED\][^\n?]*(?:is hidden\]?)/gi, "Master password: [REDACTED]");
  for (const secret of extraSecrets.filter(Boolean)) {
    redacted = redacted.split(secret).join("[REDACTED]");
  }
  return collapseRepeatedPrompts(redacted);
}

export function safeErrorMessage(error: unknown, extraSecrets: string[] = []): string {
  if (error instanceof Error) return redactSecrets(error.message, extraSecrets);
  return redactSecrets(String(error), extraSecrets);
}

function redactLocalPaths(value: string): string {
  let redacted = value;
  const replacements: Array<[string | undefined, string]> = [
    [process.env.LOCALAPPDATA, "%LOCALAPPDATA%"],
    [process.env.APPDATA, "%APPDATA%"],
    [process.env.USERPROFILE, "%USERPROFILE%"],
    [process.env.HOME, "$HOME"]
  ];
  for (const [rawPath, label] of replacements) {
    if (!rawPath) continue;
    redacted = replaceCaseInsensitive(redacted, rawPath, label);
  }
  return redacted;
}

function normalizeCliOutput(value: string): string {
  return value
    .replace(ANSI_PATTERN, "")
    .replace(/\u001b/g, "")
    .replace(/\r/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function collapseRepeatedPrompts(value: string): string {
  return value
    .replace(/(?:\??\s*Master password:[^\n?]*\[REDACTED\][^\n?]*\s*){2,}/gi, "Master password: [REDACTED]\n")
    .trim();
}

function replaceCaseInsensitive(value: string, needle: string, replacement: string): string {
  if (!needle) return value;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value.replace(new RegExp(escaped, "gi"), replacement);
}
