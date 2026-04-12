# Release

## Checklist

1. Update `version` in `package.json`
2. `bun install` to refresh the lockfile
3. `bun run all` (type check + test + build)
4. Commit and push to `main`
5. Create a GitHub Release with tag `vX.Y.Z`
6. Update the floating major tag:
   ```bash
   git tag -fa v1 -m "Update v1 to vX.Y.Z"
   git push origin v1 --force
   ```

## Versioning

- Semver tags: `v1.0.0`, `v1.1.0`, `v1.2.0`
- Floating major tag: `v1` always points to the latest `v1.x.x`
- Users reference: `uses: shubh73/react-compiler-action@v1`
