# Oxc Configuration

This project uses [oxlint](https://oxc.rs/docs/guide/usage/linter.html) for linting.

## Installed Packages

- `oxlint@1.42.0` - Fast JavaScript/TypeScript linter

## Configuration Files

### .oxlintrc.json
Linting configuration with plugins for:
- `import` - Import/export rules
- `typescript` - TypeScript-specific rules
- `unicorn` - Various helpful rules

Key rules enabled:
- `no-unused-vars` (error)
- `no-debugger` (error)
- `no-console` (warn)
- `no-double-equals` (error)
- `no-explicit-any` (warn)
- And more...

## Available Commands

### npm/pnpm scripts

```bash
# Type checking
pnpm run typecheck

# Linting
pnpm run lint          # Check for issues
pnpm run lint:fix      # Auto-fix issues
```

### Just commands

```bash
just typecheck        # TypeScript type checking
just lint             # Run oxlint
just lint-fix         # Auto-fix linting issues
just check            # Run all quality checks (typecheck + lint)
```

## Notes

- oxlint is extremely fast and catches many common issues
- Console warnings are set to "warn" level since this is a CLI tool that uses console output
- Ignored directories: `dist/`, `node_modules/`, `out/`
