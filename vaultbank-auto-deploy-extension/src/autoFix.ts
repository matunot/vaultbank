import * as fs from 'fs';
import * as path from 'path';
import { Octokit } from '@octokit/rest';
import * as vscode from 'vscode';

/**
 * Simple auto‑fix routine that attempts to make the CI workflow runnable.
 * Currently it:
 *   1. Prepends a comment marker to the workflow file so that a change is committed.
 *   2. Checks that the required Vercel secrets exist in the repository; if any are missing,
 *      it notifies the user (creating real secrets would require encryption of the value).
 * This function can be expanded in the future to perform more sophisticated fixes.
 */
export async function autoFixWorkflowAndSecrets(root: string, octokit: Octokit): Promise<void> {
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
  } else {
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
      vscode.window.showWarningMessage(
        `Missing repository secrets: ${missing.join(', ')}. Please add them manually in the GitHub Settings.`
      );
    }
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to list repository secrets: ${err}`);
  }
}
