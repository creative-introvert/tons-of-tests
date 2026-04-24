## Rules

- When you write comments, describing the "why" or "what", if not obvious from code, never the "how".
- Never include jsdoc type hints, we're using typescript.
- Typesafety over type casts and defensive programming. Parse, don't validate.
- Only write economic, high-impact tests. Don't write tests that are already validated by the type system. Don't write tests for config, grammars, etc.
- If a user provided command doesn't work, highlight this for the user to fix.
- Keep documentation in sync with code changes.

## Testing

- Group test cases using `.each`, as opposed to writing individual test cases.
    - Provide `expected`, `input`, `description`, etc in the each objects.
    - Avoid using conditional asserts.
- Avoid asserting against error messages, prefer checking effect tags or instanceof

## Commands

Run `just` to check all available commands.
