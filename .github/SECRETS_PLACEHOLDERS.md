# Placeholder Secrets for CI/CD

This repository uses several GitHub Actions secrets for deployment and runtime configuration.
During CI/CD validation we replace any missing secrets with **dummy placeholder values** to allow the workflow to run without exposing real credentials.

## List of Placeholder Secrets

| Secret                  | Placeholder Value                                                 |
| ----------------------- | ----------------------------------------------------------------- |
| `VERCEL_TOKEN`          | `DUMMY_VERCEL_TOKEN_FOR_TESTING_ONLY`                             |
| `VERCEL_ORG_ID`         | `DUMMY_VERCEL_ORG_ID_FOR_TESTING_ONLY`                            |
| `VERCEL_PROJECT_ID`     | `DUMMY_VERCEL_PROJECT_ID_FOR_TESTING_ONLY`                        |
| `NEXT_PUBLIC_API_TOKEN` | `DUMMY_NEXT_PUBLIC_API_TOKEN_FOR_TESTING_ONLY`                    |
| `ENCRYPTION_KEY`        | `DUMMY_ENCRYPTION_KEY_FOR_TESTING_ONLY`                           |
| `DATABASE_URL`          | `postgres://dummy:dummy@localhost:5432/dummy_db_for_testing_only` |

These values **do not provide any real access** and are only intended to satisfy the CI pipeline's requirement for the presence of these secrets.

## Why These Are Placeholders

- **Security** – Real credentials must never be committed to the repository or logged.
- **Automation** – Allows CI to run in a clean environment (e.g., CI runners) without manual secret provisioning.
- **Validation** – The CI pipeline includes checks that detect placeholder values and will block any real deployment until they are replaced.

## Steps to Replace Placeholders with Real Secrets

1. Navigate to **GitHub → Settings → Secrets and variables → Actions** for this repository.
2. Click **New repository secret** for each secret listed above.
3. Enter the **real secret value** (e.g., the actual Vercel token, database URL, etc.).
4. Delete the corresponding placeholder entry from this file (or mark the file as archived after all secrets are replaced).
5. Once all placeholders are replaced, the CI workflow will be able to perform a real deployment.

> **Important:** After replacing the placeholders, ensure that the CI runbook is consulted for any additional steps required before merging the PR.
