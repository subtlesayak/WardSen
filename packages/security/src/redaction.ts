const SECRET_PATTERN = /((?:"?(?:accessPassword|masterPassword|password|token|secret|session|key|totp)"?\s*[:=]\s*))(["']?)([^"',;}\s]+)\2/gi;

export function redactSecrets(value: string, extraSecrets: string[] = []): string {
  let redacted = value.replace(SECRET_PATTERN, (_match, prefix: string, quote: string) => `${prefix}${quote}[REDACTED]${quote}`);
  for (const secret of extraSecrets.filter(Boolean)) {
    redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted;
}

export function safeErrorMessage(error: unknown, extraSecrets: string[] = []): string {
  if (error instanceof Error) return redactSecrets(error.message, extraSecrets);
  return redactSecrets(String(error), extraSecrets);
}
