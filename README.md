# pi-ext-cursor-rules

Cursor-style project [rules](https://cursor.com/docs/rules) for `pi-coding-agent`.

## What this does

This extension loads rules from:

- `.cursor/rules/**/*.md`
- `.cursor/rules/**/*.mdc`

It supports the basic Cursor rule behavior:

- `alwaysApply: true` -> rule content is injected into the system prompt every turn
- `globs: ...` -> rules are enforced for matching files (read/write/edit is blocked until rule content is in context)
- `description: ...` (without `alwaysApply`/`globs`) -> rule is listed as available for intelligent use

It intentionally skips advanced/non-basic features (team rules, remote imports, etc.).

## Install

### Option 1: Install as a pi package from git

```bash
pi install git:github.com/dougefresher/pi-ext-cursor-rules
```

Or add it to `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    "git:github.com/dougefresher/pi-ext-cursor-rules"
  ]
}
```

### Option 2: Arch Linux (AUR)

```bash
paru -S pi-ext-cursor-rules
```

## Usage

1. Add rules under `.cursor/rules/` in your project
2. Start `pi` in that project
3. Extension auto-loads and applies rules
