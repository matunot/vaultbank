# Contributing to VaultBank

Thank you for your interest in contributing to **VaultBank**! Please follow these guidelines to make the contribution process smooth.

## Prerequisites

- **Node.js**: This project requires Node **24.x**. Use `nvm` to install and switch to the correct version:
  ```bash
  nvm install 24
  nvm use 24
  ```
- **Pre‑install check**: The repository includes a `preinstall` script that warns if the wrong Node version is used. It runs automatically when you run `npm install` or `npm ci`.

## Getting the code

```bash
git clone https://github.com/<owner>/vaultbank.git
cd vaultbank
```

## Installing dependencies

Never run `npm install` in CI. Use `npm ci` to install a clean, reproducible set of dependencies:

```bash
npm ci
```

This will also run the pre‑install check.

## Development

- To start the client and server concurrently:

  ```bash
  npm run dev
  ```

- To build the client for production:

  ```bash
  npm run build
  ```

- To run the CI smoke test locally:

  ```bash
  npm run smoke-test
  ```

## Commit messages

Use conventional commit style:

```
type(scope): short description

[optional body]
[optional footer]
```

Common types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`.

## Pull Requests

- Ensure the CI smoke test passes (`npm run smoke-test`).
- Make sure you are on the latest `main` branch.
- Follow the PR template in `.github/pull_request_template.md`.

## Branch protection

The `main` branch is protected. All changes must go through a PR that passes the required status checks.

## License

By contributing, you agree that your contributions will be licensed under the project's license.
