export interface ErrorHelp {
  title: string;
  detail: string;
  guidance: string;
  actionLabel?: string;
  actionHref?: string;
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
      actionHref: providerHelp.actionHref
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

function providerToolHelp(lowerDetail: string): Pick<ErrorHelp, "guidance" | "actionLabel" | "actionHref"> {
  if (lowerDetail.includes('"bw"')) {
    return {
      guidance: "Install the Bitwarden command-line tool, then close and reopen WardSen before retrying. No terminal is required if you use the official installer/download guide. Advanced users can also install with npm, Chocolatey or Homebrew.",
      actionLabel: "Open Bitwarden CLI install guide",
      actionHref: "https://bitwarden.com/help/cli/"
    };
  }
  if (lowerDetail.includes('"keepassxc-cli"')) {
    return {
      guidance: "Install KeePassXC, then close and reopen WardSen before retrying. No terminal is required if you use the official Windows or macOS download.",
      actionLabel: "Open KeePassXC download",
      actionHref: "https://keepassxc.org/download/"
    };
  }
  return {
    guidance: "Install the missing provider tool, then close and reopen WardSen before retrying. If your organization manages apps for you, ask IT to install the provider tool on this computer."
  };
}
