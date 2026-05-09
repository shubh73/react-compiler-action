# Release

## Checklist

1. Update `version` in `package.json`
2. `bun install` to refresh the lockfile
3. `bun run all` (type check + test + build)
4. Commit `src/`, `dist/`, and `package.json` together (the `check-dist`
   workflow enforces that `dist/` matches `src/`) and push to `main`
5. Wait for CI to go green on `main` before tagging
6. Create a GitHub Release with tag `vX.Y.Z`. Once published, this tag is
   immutable. Never force-push it.
7. Update the floating major tag. Force-pushing this one is intentional:
   ```bash
   git tag -fa v1 -m "Update v1 to vX.Y.Z"
   git push origin v1 --force
   ```
   `v1` is the only tag that ever gets force-pushed. Running
   `git push origin vX.Y.Z --force` would silently rewrite a published
   release.

## Versioning

- Semver tags: `v1.0.0`, `v1.1.0`, `v1.2.0`
- Floating major tag: `v1` always points to the latest `v1.x.x`
- Users reference: `uses: shubh73/react-compiler-action@v1`
