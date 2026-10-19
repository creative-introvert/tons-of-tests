set shell := ["bash", "-euo", "pipefail", "-c"]

[doc('List available recipes')]
[group('Core')]
help:
    @just --list --unsorted

[doc('Build JavaScript, declarations, and publishable packages')]
[group('Core')]
build:
    pnpm run build

[doc('Check lint and formatting')]
[group('Checks')]
check:
    pnpm run check

[doc('Apply lint and format fixes')]
[group('Development')]
check-fix:
    pnpm exec oxlint --type-aware --fix
    pnpm exec oxfmt

[doc('Check workspace source, tests, and tooling')]
[group('Checks')]
typecheck:
    pnpm exec tsc --build tsconfig.json tsconfig.typecheck.json

[doc('Watch workspace source, tests, and tooling for type errors')]
[group('Development')]
typecheck-watch:
    pnpm exec tsc --build tsconfig.json tsconfig.typecheck.json --watch

[doc('Run all unit tests')]
[group('Checks')]
test *args:
    pnpm run test {{args}}

[doc('Run unit tests in watch mode')]
[group('Development')]
test-watch *args:
    pnpm exec vitest {{args}}

[doc('Run all checks and build publishable packages')]
[group('Checks')]
verify: check typecheck test build

[doc('Write a changeset')]
[group('Development')]
changeset:
    pnpm exec changeset

[doc('Apply changesets and update the CLI version')]
[group('Development')]
changeset-version:
    pnpm run changesets-version
    pnpm exec oxfmt

[doc('Build and publish packages')]
[group('Core')]
changeset-publish:
    pnpm run changesets-publish
