# Release

## Checklist

1. Update `version` in `package.json`
2. Run `bun install` to refresh the lockfile
3. Run `bun run all` (type check + test + build)
4. Commit: `git commit -m "release v1.x.x"`
5. Run `./script/release` and enter the new version tag
6. Create a GitHub Release from the new tag
   - Use auto-generated release notes (configured in `.github/release.yml`)
7. Verify the marketplace listing is updated

## How versioning works

- Full semver tags: `v1.0.0`, `v1.1.0`, `v1.2.0`
- Floating major tag: `v1` always points to the latest `v1.x.x`
- Users reference: `uses: shubh73/react-compiler-action@v1`
- The `script/release` script handles creating both tags and pushing them
