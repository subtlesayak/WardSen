const SECRET_PATTERN = /((?:"?(?:accessPassword|masterPassword|password|token|secret|session|key|totp)"?\s*[:=]\s*))(["']?)([^"',;}\s]+)\2/gi;

export function redactSecrets(value: string, extraSecrets: string[] = []): string {
  let redacted = redactLocalPaths(value).replace(SECRET_PATTERN, (_match, prefix: string, quote: string) => `${prefix}${quote}[REDACTED]${quote}`);
  for (const secret of extraSecrets.filter(Boolean)) {
    redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted;
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

function replaceCaseInsensitive(value: string, needle: string, replacement: string): string {
  if (!needle) return value;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value.replace(new RegExp(escaped, "gi"), replacement);
}
