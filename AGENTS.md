# AGENTS.md

- Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, `docs:`)
- Keep tool descriptions concise but explicit about expected input/output formats
- Return structured JSON from tools, errors via `isError: true`
- Validate inputs with Zod schemas
- Handle reconnection/auth refresh transparently in client layer
- No hardcoded secrets - use environment variables
