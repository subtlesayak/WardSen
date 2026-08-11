import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { redactSecrets } from "./redaction";

const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;

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
  maxOutputBytes?: number;
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
  const maxOutputBytes = input.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  return await new Promise<CliCommandResult>((resolve, reject) => {
    const child = spawn(input.executable, input.args, {
      cwd: input.cwd,
      env: buildChildEnvironment(input.env),
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: input.interactive ? "pipe" : ["pipe", "pipe", "pipe"]
    });

    const stdout = boundedOutput("stdout", maxOutputBytes);
    const stderr = boundedOutput("stderr", maxOutputBytes);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      terminateProcessTree(child, "SIGTERM");
      setTimeout(() => terminateProcessTree(child, "SIGKILL"), 1500).unref();
      const result = finalize(124);
      reject(new CliCommandError(timeoutMessage(input, result, timeoutMs), result, input.executable, input.args));
      settled = true;
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout.append(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr.append(chunk);
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
      const stdoutValue = stdout.value();
      const stderrValue = stderr.value();
      const preserveRawOutput = input.rawOutput && exitCode === 0;
      return {
        exitCode,
        stdout: preserveRawOutput ? stdoutValue : redactSecrets(stdoutValue, input.redact),
        stderr: preserveRawOutput ? stderrValue : redactSecrets(stderrValue, input.redact),
        durationMs: Date.now() - start
      };
    }
  });
}

function boundedOutput(label: "stdout" | "stderr", limitBytes: number) {
  const chunks: Buffer[] = [];
  let capturedBytes = 0;
  let truncated = false;
  return {
    append(chunk: Buffer | string) {
      if (capturedBytes >= limitBytes) {
        truncated = true;
        return;
      }
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = limitBytes - capturedBytes;
      if (buffer.byteLength > remaining) {
        chunks.push(buffer.subarray(0, remaining));
        capturedBytes = limitBytes;
        truncated = true;
        return;
      }
      chunks.push(buffer);
      capturedBytes += buffer.byteLength;
    },
    value() {
      const output = Buffer.concat(chunks).toString("utf8");
      if (!truncated) return output;
      return `${output}\n[WardSen truncated ${label} after ${limitBytes} bytes]`;
    }
  };
}

function terminateProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid;
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/pid", String(pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    child.kill(signal);
  }
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
    ? "Install the Bitwarden CLI, then close and reopen WardSen. On macOS, Finder-launched apps may not inherit Terminal PATH, so WardSen also checks /opt/homebrew/bin/bw, /usr/local/bin/bw, /opt/local/bin/bw and its local tools folder."
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
  if (input.maxOutputBytes !== undefined && (!Number.isInteger(input.maxOutputBytes) || input.maxOutputBytes <= 0)) {
    throw new Error("Invalid CLI output limit");
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
