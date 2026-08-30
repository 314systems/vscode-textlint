import * as vscode from "vscode";

import { State, ErrorHandler, CloseAction, RevealOutputChannelOn } from "vscode-languageclient";

import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

import { Utils as URIUtils } from "vscode-uri";

import {
  StatusNotification,
  NoConfigNotification,
  NoLibraryNotification,
  ExitNotification,
  ExtensionSettings,
  defaultServerInitializationOptions,
} from "../shared/types";

import { LanguageStatus } from "./status";
import type { StatusLevel } from "./status";

const defaultConfig: ExtensionSettings = {
  ...defaultServerInitializationOptions,
  languages: [],
};

export interface ExtensionInternal {
  readonly client: LanguageClient;
  readonly status: LanguageStatus;
}

function reportServerState(status: LanguageStatus, state: State): void {
  status.busy = state === State.Starting;
  switch (state) {
    case State.Starting:
      break;
    case State.Running:
      status.report("ok");
      break;
    case State.Stopped:
      status.report("error", "textlint server stopped.");
      break;
    case State.StartFailed:
      status.report("error", "textlint server failed to start.");
      break;
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<ExtensionInternal> {
  const client = newClient(context);
  const status = new LanguageStatus(readConfig().languages, client);
  client.onDidChangeState((event) => {
    reportServerState(status, event.newState);
  });
  client.onNotification(StatusNotification.type, (params) => {
    status.report(toLevel(params.status), params.message, params.cause);
  });
  client.onNotification(NoConfigNotification.type, (params) => {
    status.report(
      "warn",
      `No textlint configuration (e.g .textlintrc) found in ${params.workspaceFolder} .
File will not be validated. Consider running the 'Create .textlintrc file' command.`,
    );
  });
  client.onNotification(NoLibraryNotification.type, (params) => {
    status.report(
      "warn",
      `Failed to load the textlint library in ${params.workspaceFolder} .
To use textlint in this workspace please install textlint using 'npm install textlint' or globally using 'npm install -g textlint'.
You need to reopen the workspace after installing textlint.`,
    );
  });
  context.subscriptions.push(
    vscode.commands.registerCommand("textlint.createConfig", createConfig),
    vscode.commands.registerCommand("textlint.showOutputChannel", () => {
      client.outputChannel.show();
    }),
    client,
    status,
  );
  await client.start();
  // for testing purpose
  return {
    client,
    status,
  };
}

function newClient(context: vscode.ExtensionContext): LanguageClient {
  const module = URIUtils.joinPath(context.extensionUri, "dist", "server.js").fsPath;
  const debugOptions = { execArgv: ["--nolazy", "--inspect=6011"] };
  const serverOptions: ServerOptions = {
    run: { module, transport: TransportKind.ipc },
    debug: { module, transport: TransportKind.ipc, options: debugOptions },
  };
  let defaultErrorHandler: ErrorHandler;
  let serverCalledProcessExit = false;
  const textlintConfig = readConfig();
  const clientOptions: LanguageClientOptions = {
    documentSelector: textlintConfig.languages.map((id) => {
      return { language: id, scheme: "file" };
    }),
    diagnosticCollectionName: "textlint",
    revealOutputChannelOn: RevealOutputChannelOn.Error,
    synchronize: {
      fileEvents: [
        vscode.workspace.createFileSystemWatcher("**/package.json"),
        vscode.workspace.createFileSystemWatcher("**/.textlintrc"),
        vscode.workspace.createFileSystemWatcher("**/.textlintrc.{js,json,yml,yaml}"),
        vscode.workspace.createFileSystemWatcher("**/.textlintignore"),
      ],
    },
    initializationFailedHandler: (error) => {
      client.error("Server initialization failed.", error);
      return false;
    },
    errorHandler: {
      error: (error, message, count) => {
        return defaultErrorHandler.error(error, message, count);
      },
      closed: () => {
        if (serverCalledProcessExit) {
          return { action: CloseAction.DoNotRestart };
        }
        return defaultErrorHandler.closed();
      },
    },
  };
  const client = new LanguageClient("textlint", serverOptions, clientOptions);
  defaultErrorHandler = client.createDefaultErrorHandler();
  client.onNotification(ExitNotification.type, () => {
    serverCalledProcessExit = true;
  });
  return client;
}

async function createConfig() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) {
    await vscode.window.showErrorMessage(
      "An textlint configuration can only be generated if VS Code is opened on a workspace folder.",
    );
    return;
  }

  const noConfigs = await filterNoConfigFolders(folders);

  if (noConfigs.length === 0 && folders.length > 0) {
    await vscode.window.showErrorMessage(
      "textlint configuration file already exists in this workspace.",
    );
    return;
  }

  if (noConfigs.length === 1) {
    await emitConfig(noConfigs[0]);
  } else {
    const item = await vscode.window.showQuickPick(toQuickPickItems(noConfigs));
    if (item) {
      await emitConfig(item.folder);
    }
  }
}

async function filterNoConfigFolders(
  folders: readonly vscode.WorkspaceFolder[],
): Promise<vscode.WorkspaceFolder[]> {
  const results = await Promise.all(
    folders.map(async (folder) => {
      const candidates = ["", ".js", ".yaml", ".yml", ".json"].map((ext) =>
        URIUtils.joinPath(folder.uri, ".textlintrc" + ext),
      );
      const existing = await Promise.all(
        candidates.map(async (configPath) => {
          try {
            await vscode.workspace.fs.stat(configPath);
            return true;
          } catch {
            return false;
          }
        }),
      );
      return existing.includes(true) ? undefined : folder;
    }),
  );
  return results.filter((folder) => folder !== undefined);
}

async function emitConfig(folder: vscode.WorkspaceFolder) {
  await vscode.workspace.fs.writeFile(
    URIUtils.joinPath(folder.uri, ".textlintrc"),
    Buffer.from(
      `{
  "filters": {},
  "rules": {}
}`,
      "utf8",
    ),
  );
}

function toQuickPickItems(
  folders: readonly vscode.WorkspaceFolder[],
): ({ folder: vscode.WorkspaceFolder } & vscode.QuickPickItem)[] {
  return folders.map((folder) => {
    return {
      label: folder.name,
      description: folder.uri.path,
      folder,
    };
  });
}

function readConfig(): ExtensionSettings {
  const config = vscode.workspace.getConfiguration("textlint");
  return {
    languages: config.get("languages", defaultConfig.languages),
    configPath: config.get("configPath", defaultConfig.configPath),
    ignorePath: config.get("ignorePath", defaultConfig.ignorePath),
    nodePath: config.get("nodePath", defaultConfig.nodePath),
    run: config.get("run", defaultConfig.run),
    targetPath: config.get("targetPath", defaultConfig.targetPath),
  };
}

function toLevel(status: StatusNotification.Status): StatusLevel {
  switch (status) {
    case StatusNotification.Status.OK:
      return "ok";
    case StatusNotification.Status.WARN:
      return "warn";
    case StatusNotification.Status.ERROR:
      return "error";
    default:
      return "error";
  }
}
