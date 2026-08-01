export interface ErrorHelp {
  title: string;
  detail: string;
  guidance: string;
  actionLabel?: string;
  actionHref?: string;
  setupNotes?: string[];
  terminalCommands?: TerminalCommandHelp[];
}

export interface TerminalCommandHelp {
  label: string;
  command: string;
  note: string;
}

export function describeError(message?: string): ErrorHelp {
  const detail = cleanMessage(message);
  const lower = detail.toLowerCase();

  if (lower.includes("cross-origin request blocked") || lower.includes("cross-origin requests are not allowed")) {
    return {
      title: "WardSen blocked a cross-origin request",
      detail,
      guidance: "Open WardSen from the local app URL or packaged desktop app, then retry the action. Requests from another site, preview host, or proxy are rejected for your vault safety."
    };
  }

  if (lower.includes("failed to fetch") || lower.includes("load failed") || lower.includes("networkerror") || lower.includes("could not connect to wardsen local service")) {
    return {
      title: "WardSen could not reach the local service",
      detail,
      guidance: "Use Restart service and retry in the desktop app. If the same message returns, close and reopen WardSen so the bundled local service can start again."
    };
  }

  if (lower.includes("desktop api token")) {
    return {
      title: "WardSen desktop session is not trusted",
      detail,
      guidance: "Close all WardSen windows, reopen the desktop app, then retry. The local service only accepts requests from the matching desktop session."
    };
  }

  if (lower.includes("provider command") && lower.includes("was not found")) {
    const providerHelp = providerToolHelp(lower);
    return {
      title: "WardSen could not find a provider tool",
      detail,
      guidance: providerHelp.guidance,
      actionLabel: providerHelp.actionLabel,
      actionHref: providerHelp.actionHref,
      setupNotes: providerHelp.setupNotes,
      terminalCommands: providerHelp.terminalCommands
    };
  }

  if (lower.includes("requires confirmation") || lower.includes("confirmation phrase")) {
    return {
      title: "Confirmation is required",
      detail,
      guidance: "Review the delivery summary and enter the exact confirmation phrase shown before retrying."
    };
  }

  if (lower.includes("unlock") || lower.includes("locked") || lower.includes("login")) {
    return {
      title: "Vault access needs attention",
      detail,
      guidance: "Check the selected vault account, unlock or log in again, then retry the action."
    };
  }

  return {
    title: "WardSen could not complete that action",
    detail,
    guidance: "Review the detail below, adjust the input or provider state, then retry."
  };
}

function cleanMessage(message?: string) {
  const value = message?.trim();
  return value ? value : "No additional detail was returned.";
}

function providerToolHelp(lowerDetail: string): Pick<ErrorHelp, "guidance" | "actionLabel" | "actionHref" | "setupNotes" | "terminalCommands"> {
  if (lowerDetail.includes('"bw"')) {
    return {
      guidance: "Install the Bitwarden command-line tool, then close and reopen WardSen before retrying. No terminal is required if you use the official download guide, but the downloaded bw executable must be available on PATH.",
      actionLabel: "Open Bitwarden CLI install guide",
      actionHref: "https://bitwarden.com/help/cli/",
      setupNotes: [
        "Windows: download the Windows x64 native executable, extract it into a permanent folder, add that folder to PATH, then close and reopen WardSen.",
        "macOS Intel: download the macOS x64 native executable, allow it to run, add its folder to PATH, then close and reopen WardSen.",
        "macOS Apple Silicon or other arm64 devices: use NPM, because Bitwarden recommends installing the CLI with npm on arm64.",
        "To verify setup, open Terminal, PowerShell or Command Prompt and run bw --version."
      ],
      terminalCommands: [
        {
          label: "Windows or macOS with Node.js",
          command: "npm install -g @bitwarden/cli",
          note: "Use this if Node.js is installed. This is the recommended route for macOS Apple Silicon and other arm64 devices."
        },
        {
          label: "Windows with Chocolatey",
          command: "choco install bitwarden-cli",
          note: "Use this only if Chocolatey is installed. Close and reopen WardSen after it finishes."
        }
      ]
    };
  }
  if (lowerDetail.includes('"keepassxc-cli"')) {
    return {
      guidance: "Install KeePassXC, then close and reopen WardSen before retrying. No terminal is required if you use the official Windows or macOS download.",
      actionLabel: "Open KeePassXC download",
      actionHref: "https://keepassxc.org/download/",
      terminalCommands: [
        {
          label: "Windows PowerShell or Command Prompt",
          command: "winget install KeePassXCTeam.KeePassXC",
          note: "Use this if winget is available. Close and reopen WardSen after it finishes."
        },
        {
          label: "macOS Terminal with Homebrew",
          command: "brew install --cask keepassxc",
          note: "Use this on macOS if Homebrew is installed. Close and reopen WardSen after it finishes."
        }
      ]
    };
  }
  return {
    guidance: "Install the missing provider tool, then close and reopen WardSen before retrying. If your organization manages apps for you, ask IT to install the provider tool on this computer."
  };
}
