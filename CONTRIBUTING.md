# Contributing to @sipheron/vdr-pipeline

First, thank you for considering contributing to `vdr-pipeline`! We welcome contributions from everyone, whether it's bug fixes, documentation improvements, new features, or framework integrations. 

By participating in this project, you agree to abide by our [Code of Conduct](./CODE_OF_CONDUCT.md).

## Getting Started

1.  **Fork** the repository on GitHub.
2.  **Clone** your fork locally: `git clone https://github.com/your-username/vdr-pipeline.git`
3.  **Install dependencies**:
    ```bash
    cd vdr-pipeline
    npm install
    ```

## Development Workflow

1.  **Create a branch**: For each new feature or bug fix, create a new branch from `master`.
    ```bash
    git checkout -b feature/your-feature-name
    ```
2.  **Make your changes**: Write clean, concise, and documented TypeScript code.
3.  **Ensure type safety**: We enforce strict TypeScript rules.
    ```bash
    npm run build
    ```
4.  **Write and run tests**: Ensure your logic is covered by unit or integration tests (we use Jest).
    ```bash
    npm run test
    ```

## Code Standards
*   **TypeScript**: All source files must be written in TypeScript (`.ts`).
*   **Formatting**: Follow the existing Prettier and ESLint configurations. Avoid massive formatting changes unrelated to your logic.
*   **Cryptographic Primitives**: Do NOT introduce new hashing or cryptographic algorithms directly. All cryptographic interactions must be routed through `@sipheron/vdr-core` or the ZK protocols formally defined in the project architecture. 

## Pull Request Process

1.  Push your branch to your fork.
2.  Open a Pull Request against the `master` branch of the upstream repository.
3.  Provide a clear and descriptive title and a summary of what you are changing. If you are fixing a bug, please link the relevant GitHub issue.
4.  Ensure all CI/CD pipelines (compilation, linting, tests) pass. 
5.  Two core team members must approve the PR before it can be merged.

## Reporting Bugs

If you find a bug, please open a GitHub Issue and include:
*   A clear description of the issue.
*   The version of `@sipheron/vdr-pipeline` and `@sipheron/vdr-core` you are using.
*   Steps to reproduce the bug.
*   Expected behavior versus actual behavior.

*Note: For security vulnerabilities, please refer to our [Security Policy](./SECURITY.md).*

Thank you for helping us build the trust infrastructure for autonomous AI!
