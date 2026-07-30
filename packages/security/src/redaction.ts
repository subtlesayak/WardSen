const SECRET_PATTERN = /(password|token|secret|session|key)=([^\s]+)/gi;

export function redactSecrets(value: string, extraSecrets: string[] = []): string {
  let redacted = value.replace(SECRET_PATTERN, "$1=[REDACTED]");
  for (const secret of extraSecrets.filter(Boolean)) {
    redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted;
}

export function safeErrorMessage(error: unknown, extraSecrets: string[] = []): string {
  if (error instanceof Error) return redactSecrets(error.message, extraSecrets);
  return redactSecrets(String(error), extraSecrets);
}
