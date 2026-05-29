# Pull Request Template

## Description

Please provide a clear description of the changes introduced by this PR. Include any relevant background information, motivation, and references to related issues.

## Checklist

- [ ] **Run locally**: Verify the changes work locally (`npm run dev` or appropriate commands).
- [ ] **Node version**: Ensure you are using Node **24.x** (`node -v`).
- [ ] **Dependencies**: Run `npm ci` to install dependencies cleanly.
- [ ] **Build**: Run `npm run build` and ensure it succeeds.
- [ ] **CI Smoke Test**: Run `npm run smoke-test` and confirm it passes.
- [ ] **Lint/Format**: Ensure code passes linting and formatting checks (`npm run lint` if available).
- [ ] **Documentation**: Update any relevant documentation (e.g., README, CONTRIBUTING.md).
- [ ] **Related Issues**: Link any related issues (e.g., `Closes #123`).

## Additional Notes

Add any additional information that reviewers might need, such as screenshots, performance considerations, or migration steps.
