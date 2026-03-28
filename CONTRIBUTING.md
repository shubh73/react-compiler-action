# Contributing

## Setup

```bash
bun install
```

## Development

```bash
bun run check-types   # Type check
bun run test          # Run tests
bun run test:watch    # Run tests in watch mode
bun run build         # Bundle with ncc
bun run all           # Type check + test + build
```

## Making changes

1. Create a branch from `main`
2. Make your changes in `src/`
3. Add or update tests in `__tests__/`
4. Run `bun run all` to verify everything passes
5. Commit both `src/` and `dist/` changes (the `check-dist` CI workflow enforces this)
6. Open a PR against `main`

## Project structure

```
src/
  index.ts      # Entry point
  main.ts       # Action orchestrator (reads inputs, coordinates everything)
  checker.ts    # Core babel-plugin-react-compiler logic
  reporter.ts   # Markdown report builder + GitHub annotations
  comment.ts    # PR comment create/update/delete via Octokit
  files.ts      # Changed-file detection + glob filtering
  types.ts      # Shared TypeScript types
```
