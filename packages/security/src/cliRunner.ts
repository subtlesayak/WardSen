import { spawn } from "node:child_process";
import { redactSecrets } from "./redaction";

export interface CliCommandInput {
  executable: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
  timeoutMs?: number;
  interactive?: boolean;
  redact?: string[];
  rawOutput?: boolean;
}

export interface CliCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export class CliCommandError extends Error {
  constructor(
    message: string,
    readonly result: CliCommandResult,
    readonly executable: string,
    readonly args: string[]
  ) {
    super(message);
    this.name = "CliCommandError";
  }
}

export async function runCliCommand(input: CliCommandInput): Promise<CliCommandResult> {
  validateCommand(input);
  const start = Date.now();
  const timeoutMs = input.timeoutMs ?? 30_000;

  return await new Promise<CliCommandResult>((resolve, reject) => {
    const child = spawn(input.executable, input.args, {
      cwd: input.cwd,
      env: buildChildEnvironment(input.env),
      shell: false,
      windowsHide: true,
      stdio: input.interactive ? "pipe" : ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1500).unref();
      const result = finalize(124);
      reject(new CliCommandError(timeoutMessage(input, result, timeoutMs), result, input.executable, input.args));
      settled = true;
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      const result = finalize(127);
      reject(new CliCommandError(providerExecutableMessage(input.executable, error), result, input.executable, input.args));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      const result = finalize(code ?? 1);
      if (result.exitCode === 0) {
        resolve(result);
      } else {
        reject(new CliCommandError(failureMessage(input, result), result, input.executable, input.args));
      }
    });

    if (input.stdin) child.stdin?.end(input.stdin);
    else child.stdin?.end();

    function finalize(exitCode: number): CliCommandResult {
      return {
        exitCode,
        stdout: input.rawOutput ? stdout : redactSecrets(stdout, input.redact),
        stderr: input.rawOutput ? stderr : redactSecrets(stderr, input.redact),
        durationMs: Date.now() - start
      };
    }
  });
}

function timeoutMessage(input: CliCommandInput, result: CliCommandResult, timeoutMs: number): string {
  const command = providerCommandLabel(input);
  const detail = commandOutputDetail(input, result);
  return `${command} timed out after ${Math.round(timeoutMs / 1000)} seconds. If a browser, SSO, email, captcha or two-step prompt opened, finish it there, then retry in WardSen. WardSen uses an isolated provider profile for each vault account, so signing in to another desktop app or terminal does not sign in this WardSen account.${detail}`;
}

function failureMessage(input: CliCommandInput, result: CliCommandResult): string {
  const command = providerCommandLabel(input);
  return `${command} failed.${commandOutputDetail(input, result)}`;
}

function providerCommandLabel(input: CliCommandInput): string {
  const tool = executableName(input.executable);
  const operation = input.args[0] ? ` ${input.args[0]}` : "";
  return `Provider command "${tool}${operation}"`;
}

function commandOutputDetail(input: CliCommandInput, result: CliCommandResult): string {
  const output = [result.stderr, result.stdout]
    .map((value) => redactSecrets(value, input.redact).trim())
    .filter(Boolean)
    .join("\n");
  if (!output) return "";
  return ` Detail: ${truncateForError(output, 900)}`;
}

function truncateForError(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}...`;
}

function providerExecutableMessage(executable: string, error: NodeJS.ErrnoException): string {
  if (error.code !== "ENOENT") return `Provider command could not start: ${error.message}`;
  const tool = executableName(executable);
  const installHint = tool === "bw"
    ? "Install the Bitwarden CLI, then close and reopen WardSen so the desktop app can see the updated PATH."
    : `Install ${tool}, then close and reopen WardSen so the desktop app can see the updated PATH.`;
  return `Provider command "${tool}" was not found. ${installHint}`;
}

function executableName(executable: string): string {
  return executable.replaceAll("\\", "/").split("/").pop() || executable;
}

function validateCommand(input: CliCommandInput): void {
  if (!input.executable || input.executable.includes("\0")) {
    throw new Error("Invalid executable");
  }
  if (!Array.isArray(input.args) || input.args.some((arg) => arg.includes("\0"))) {
    throw new Error("Invalid CLI argument");
  }
  if (input.timeoutMs !== undefined && (!Number.isInteger(input.timeoutMs) || input.timeoutMs <= 0)) {
    throw new Error("Invalid CLI timeout");
  }
}

const INHERITED_ENV_KEYS = [
  "APPDATA",
  "COMSPEC",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LOCALAPPDATA",
  "PATH",
  "PATHEXT",
  "PROCESSOR_ARCHITECTURE",
  "ProgramData",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "SystemDrive",
  "SystemRoot",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "WINDIR",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY"
];

function buildChildEnvironment(explicit: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of INHERITED_ENV_KEYS) {
    const inherited = getEnvValue(key);
    if (inherited !== undefined) env[key] = inherited;
  }
  return { ...env, ...explicit };
}

function getEnvValue(key: string): string | undefined {
  if (process.env[key] !== undefined) return process.env[key];
  const found = Object.keys(process.env).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
  return found ? process.env[found] : undefined;
}
