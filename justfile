# Monorepo command rules:
# - Use `just` for orchestration; keep command chains shallow and explicit.
# - Use pnpm scripts via `just` only for simple no-arg entrypoints.
# - For arg-driven tasks, run concrete commands directly in `just` (no wrapper recipes).
# - Do not wrap bash scripts in pnpm scripts; call scripts directly from `just`.

set shell := ["bash", "-euo", "pipefail", "-c"]

workspaces := env_var_or_default("WORKSPACES", "all")

[doc('List available recipes')]
[group('Core')]
help:
    @just --list --unsorted

[doc('Lint with oxlint (pass --fix to auto-fix)')]
[group('Check')]
lint *args:
    pnpm exec oxlint {{args}}

[doc('Format with oxfmt (pass --check to verify only)')]
[group('Check')]
format *args:
    pnpm exec oxfmt {{args}}
