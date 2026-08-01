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
      reject(new CliCommandError("CLI command timed out", result, input.executable, input.args));
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
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      const result = finalize(code ?? 1);
      if (result.exitCode === 0) {
        resolve(result);
      } else {
        reject(new CliCommandError("CLI command failed", result, input.executable, input.args));
      }
    });

    if (input.stdin) child.stdin?.end(input.stdin);
    else child.stdin?.end();

    function finalize(exitCode: number): CliCommandResult {
      return {
        exitCode,
        stdout: redactSecrets(stdout, input.redact),
        stderr: redactSecrets(stderr, input.redact),
        durationMs: Date.now() - start
      };
    }
  });
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
