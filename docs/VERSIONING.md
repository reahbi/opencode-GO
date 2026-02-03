# Versioning Guide

This project follows [Semantic Versioning 2.0.0](https://semver.org/).

## Version Format

```
MAJOR.MINOR.PATCH
  │      │     └── Bug fixes (backward compatible)
  │      └──────── New features (backward compatible)
  └─────────────── Breaking changes (incompatible API changes)
```

## Current Stage: 0.x.x (Pre-stable)

During the `0.x.x` phase, the API may change without notice.

| Change Type | Version Bump | Example |
|-------------|--------------|---------|
| Bug fixes, docs | PATCH | 0.1.0 → 0.1.1 |
| New features | MINOR | 0.1.1 → 0.2.0 |
| Breaking changes | MINOR | 0.2.0 → 0.3.0 |

## 1.0.0 Criteria

We will release 1.0.0 when:

- [ ] Environment variables and config format are stable
- [ ] State migrations are backward-compatible
- [ ] Core commands have consistent UX
- [ ] Users can upgrade without manual cleanup or data loss

## Conventional Commits

We use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Commit Types

| Type | Description | Version Impact |
|------|-------------|----------------|
| `feat` | New feature | MINOR |
| `fix` | Bug fix | PATCH |
| `docs` | Documentation only | None |
| `style` | Formatting, semicolons | None |
| `refactor` | Code change without feature/fix | None |
| `perf` | Performance improvement | PATCH |
| `test` | Adding/updating tests | None |
| `chore` | Build, tools, dependencies | None |

### Breaking Changes

Mark breaking changes with `!` after the type:

```bash
feat!: change session API parameter order

BREAKING CHANGE: startSession() now requires projectId as first argument.
```

## Release Checklist

Before releasing a new version:

```
□ All tests pass: bun test
□ Type check passes: bun run typecheck
□ Update CHANGELOG.md with new changes
□ Update package.json version (if not using automation)
□ Commit: git commit -m "chore: release vX.Y.Z"
□ Create tag: git tag -a vX.Y.Z -m "Release vX.Y.Z"
□ Push: git push origin main --tags
□ Create GitHub Release from the tag
  - Mark as "Pre-release" if version is 0.x.x
  - Include changelog content in release notes
```

## Changelog Format

We follow [Keep a Changelog](https://keepachangelog.com/) format:

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- New features

### Changed
- Changes to existing features

### Deprecated
- Features to be removed in future

### Removed
- Removed features

### Fixed
- Bug fixes

### Security
- Security fixes
```

## Branch Strategy

Currently using a simple single-branch strategy:

```
main ────●────●────●────●──── (tags: v0.1.0, v0.2.0, ...)
```

All development happens on `main`. Feature branches are optional for larger changes.

## Future: Automation

When the project grows, we plan to adopt [release-please](https://github.com/googleapis/release-please) for automated:
- Version bumping based on Conventional Commits
- CHANGELOG generation
- GitHub Release creation
