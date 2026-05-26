"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
const rest_1 = require("@octokit/rest");
const node_fetch_1 = __importDefault(require("node-fetch"));
const autoFix_1 = require("./autoFix");
// Repository constants – adjust if the repo location changes
const GITHUB_OWNER = "matunot";
const GITHUB_REPO = "vaultbank";
const VERCEL_URL = "https://vaultbank.vercel.app";
/** Execute a shell command and return stdout. Rejects on error. */
function execCommand(command, cwd) {
    return new Promise((resolve) => {
        // Execute the command with the provided working directory and UTF-8 encoding
        (0, child_process_1.exec)(command, { cwd, encoding: "utf8" }, (error, stdout, stderr) => {
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
async function commitAndPush(root) {
    await execCommand("git add -A", root);
    try {
        await execCommand('git commit -m "auto-commit on save"', root);
    }
    catch (e) {
        // No changes to commit – git returns non‑zero exit code
        console.log("No changes to commit");
    }
    await execCommand("git push origin main", root);
}
/** Retrieve the most recent workflow run for the main branch. */
async function getLatestWorkflowRun(octokit) {
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
async function waitForRunCompletion(octokit, runId) {
    while (true) {
        const { data } = await octokit.actions.getWorkflowRun({
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            run_id: runId,
        });
        if (data.status === "completed") {
            return data.conclusion;
        }
        // Wait a few seconds before polling again
        await new Promise((r) => setTimeout(r, 5000));
    }
}
/** Verify that the Vercel deployment URL returns HTTP 200. */
async function verifyVercel() {
    try {
        const resp = await (0, node_fetch_1.default)(VERCEL_URL, { method: "HEAD" });
        return resp.status === 200;
    }
    catch {
        return false;
    }
}
function activate(context) {
    const config = vscode.workspace.getConfiguration("vaultbank");
    const githubToken = config.get("githubToken") ?? "";
    const maxRetries = config.get("maxRetries") ?? 5;
    const octokit = new rest_1.Octokit({ auth: githubToken });
    // Core deployment logic extracted to a reusable function
    async function runDeploy() {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage("No workspace folder detected.");
            return;
        }
        const rootPath = workspaceFolder.uri.fsPath;
        vscode.window.showInformationMessage("Auto‑deploy: committing changes…");
        try {
            await commitAndPush(rootPath);
        }
        catch (e) {
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
            vscode.window.showWarningMessage(`Workflow failed (attempt ${attempts}). Running auto‑fix…`);
            try {
                await (0, autoFix_1.autoFixWorkflowAndSecrets)(rootPath, octokit);
                // Re‑commit after auto‑fix
                await commitAndPush(rootPath);
                run = await getLatestWorkflowRun(octokit);
                conclusion = await waitForRunCompletion(octokit, run.id);
            }
            catch (fixErr) {
                vscode.window.showErrorMessage(`Auto‑fix failed: ${fixErr}`);
                break;
            }
        }
        if (conclusion === "success") {
            const ok = await verifyVercel();
            if (ok) {
                vscode.window.showInformationMessage("✅ Deployment succeeded and Vercel site is reachable.");
            }
            else {
                vscode.window.showErrorMessage("Deployment succeeded but Vercel site did not return 200 OK.");
            }
        }
        else {
            vscode.window.showErrorMessage("Workflow did not succeed after retries.");
        }
    }
    // Register on-save listener
    const disposableOnSave = vscode.workspace.onDidSaveTextDocument(async (doc) => {
        await runDeploy();
    });
    // Register manual command
    const disposableCommand = vscode.commands.registerCommand("vaultbank.deploy", async () => {
        await runDeploy();
    });
    // Add disposables to context
    const disposable = vscode.Disposable.from(disposableOnSave, disposableCommand);
    context.subscriptions.push(disposable);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map