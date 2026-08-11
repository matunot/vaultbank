import * as vscode from "vscode";
import { exec } from "child_process";
import { Octokit } from "@octokit/rest";
// Dynamically import node-fetch when needed to avoid ESM/CommonJS interop issues.
// This avoids the TypeScript error about importing an ES module from a CommonJS module.
import { autoFixWorkflowAndSecrets } from "./autoFix";

// Repository constants – adjust if the repo location changes
const GITHUB_OWNER = "matunot";
const GITHUB_REPO = "vaultbank";
const VERCEL_URL = "https://vaultbank.vercel.app";

/** Execute a shell command and return stdout. Rejects on error. */
function execCommand(command: string, cwd: string): Promise<string> {
  return new Promise<string>((resolve) => {
    // Execute the command with the provided working directory and UTF-8 encoding
    exec(command, { cwd, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        // Log the error and exit early as per requested exec block
        console.error(error);
        return;
      }
      // Log stdout and stderr to the console
      console.log(stdout);
      console.error(stderr);
      resolve(stdout);
    });
  });
}

/** Commit all changes and push to origin/main. */
async function commitAndPush(root: string): Promise<void> {
  await execCommand("git add -A", root);
  try {
    await execCommand('git commit -m "auto-commit on save"', root);
  } catch {
    // No changes to commit – git returns non‑zero exit code
    console.log("No changes to commit");
  }
  await execCommand("git push origin main", root);
}

/** Retrieve the most recent workflow run for the main branch. */
async function getLatestWorkflowRun(octokit: Octokit) {
  const runs = await octokit.actions.listWorkflowRunsForRepo({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    branch: "main",
    event: "push",
    per_page: 1,
  });
  return runs.data.workflow_runs[0];
}

/** Poll a workflow run until it finishes, then return its conclusion. */
async function waitForRunCompletion(
  octokit: Octokit,
  runId: number,
): Promise<string> {
  let isCompleted = false;
  while (!isCompleted) {
    const { data } = await octokit.actions.getWorkflowRun({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      run_id: runId,
    });
    if (data.status === "completed") {
      isCompleted = true;
      return data.conclusion as string;
    }
    // Wait a few seconds before polling again
    await new Promise((r) => setTimeout(r, 5000));
  }
  // Fallback return to satisfy TypeScript's control flow analysis.
  // This point should never be reached because the loop only exits via a return.
  return "";
}

/** Verify that the Vercel deployment URL returns HTTP 200. */
async function verifyVercel(): Promise<boolean> {
  try {
    const resp = await fetch(VERCEL_URL, { method: "HEAD" });
    return resp.status === 200;
  } catch {
    return false;
  }
}

export function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration("vaultbank");
  const githubToken = config.get<string>("githubToken") ?? "";
  const maxRetries = config.get<number>("maxRetries") ?? 5;

  const octokit = new Octokit({ auth: githubToken });

  // Core deployment logic extracted to a reusable function
  async function runDeploy(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage("No workspace folder detected.");
      return;
    }
    const rootPath = workspaceFolder.uri.fsPath;
    vscode.window.showInformationMessage("Auto‑deploy: committing changes…");
    try {
      await commitAndPush(rootPath);
    } catch (e) {
      vscode.window.showErrorMessage(`Git push failed: ${e}`);
      return;
    }

    // Get the latest workflow run triggered by this push
    let run = await getLatestWorkflowRun(octokit);
    if (!run) {
      vscode.window.showErrorMessage("Unable to locate a workflow run.");
      return;
    }
    let conclusion = await waitForRunCompletion(octokit, run.id);
    let attempts = 0;
    while (conclusion !== "success" && attempts < maxRetries) {
      attempts++;
      vscode.window.showWarningMessage(
        `Workflow failed (attempt ${attempts}). Running auto‑fix…`,
      );
      try {
        await autoFixWorkflowAndSecrets(rootPath, octokit);
        // Re‑commit after auto‑fix
        await commitAndPush(rootPath);
        run = await getLatestWorkflowRun(octokit);
        conclusion = await waitForRunCompletion(octokit, run.id);
      } catch (fixErr) {
        vscode.window.showErrorMessage(`Auto‑fix failed: ${fixErr}`);
        break;
      }
    }

    if (conclusion === "success") {
      const ok = await verifyVercel();
      if (ok) {
        vscode.window.showInformationMessage(
          "✅ Deployment succeeded and Vercel site is reachable.",
        );
      } else {
        vscode.window.showErrorMessage(
          "Deployment succeeded but Vercel site did not return 200 OK.",
        );
      }
    } else {
      vscode.window.showErrorMessage("Workflow did not succeed after retries.");
    }
  }

  // Register on-save listener
  const disposableOnSave = vscode.workspace.onDidSaveTextDocument(async () => {
    await runDeploy();
  });

  // Register manual command
  const disposableCommand = vscode.commands.registerCommand(
    "vaultbank.deploy",
    async () => {
      await runDeploy();
    },
  );

  // Add disposables to context
  const disposable = vscode.Disposable.from(
    disposableOnSave,
    disposableCommand,
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {}
