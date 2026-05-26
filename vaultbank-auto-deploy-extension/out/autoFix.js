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
Object.defineProperty(exports, "__esModule", { value: true });
exports.autoFixWorkflowAndSecrets = autoFixWorkflowAndSecrets;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
/**
 * Simple auto‑fix routine that attempts to make the CI workflow runnable.
 * Currently it:
 *   1. Prepends a comment marker to the workflow file so that a change is committed.
 *   2. Checks that the required Vercel secrets exist in the repository; if any are missing,
 *      it notifies the user (creating real secrets would require encryption of the value).
 * This function can be expanded in the future to perform more sophisticated fixes.
 */
async function autoFixWorkflowAndSecrets(root, octokit) {
    const workflowPath = path.join(root, '.github', 'workflows', 'deploy.yml');
    if (!fs.existsSync(workflowPath)) {
        vscode.window.showErrorMessage(`Workflow file not found at ${workflowPath}`);
        return;
    }
    // 1. Ensure the workflow file is touched so that a new commit is created.
    const marker = '# Auto-fix applied';
    let content = fs.readFileSync(workflowPath, 'utf8');
    if (!content.includes(marker)) {
        content = `${marker}\n${content}`;
        fs.writeFileSync(workflowPath, content, 'utf8');
        vscode.window.showInformationMessage('Auto‑fix: added marker to workflow file.');
    }
    else {
        vscode.window.showInformationMessage('Auto‑fix: workflow already contains marker.');
    }
    // 2. Verify required repository secrets exist. If missing, warn the user.
    const requiredSecrets = ['VERCEL_TOKEN', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID'];
    try {
        const { data } = await octokit.actions.listRepoSecrets({
            owner: 'matunot',
            repo: 'vaultbank',
        });
        const existing = new Set(data.secrets.map(s => s.name));
        const missing = requiredSecrets.filter(name => !existing.has(name));
        if (missing.length > 0) {
            vscode.window.showWarningMessage(`Missing repository secrets: ${missing.join(', ')}. Please add them manually in the GitHub Settings.`);
        }
    }
    catch (err) {
        vscode.window.showErrorMessage(`Failed to list repository secrets: ${err}`);
    }
}
//# sourceMappingURL=autoFix.js.map