import * as path from "node:path"
import type { UserConfig } from "vitest/config"
import tsconfigPaths from 'vite-tsconfig-paths'

// const alias = (pkg: string) => ({
//   [`@effect/${pkg}/test`]: path.join(__dirname, "packages", pkg, "test"),
//   [`@effect/${pkg}`]: path.join(__dirname, "packages", pkg, "src")
// })

// This is a workaround, see https://github.com/vitest-dev/vitest/issues/4744
const config: UserConfig = {
  esbuild: {
    target: "es2020"
  },
  plugins: [tsconfigPaths()],
  // optimizeDeps: {
  //   exclude: ["bun:sqlite"]
  // },
  test: {
    // setupFiles: [path.join(__dirname, "setupTests.ts")],
    fakeTimers: {
      toFake: undefined
    },
    sequence: {
      concurrent: true
    },
    include: ["**/*.spec.ts"],
    // alias: {
    //   // TODO: Should we use `effect/test` instead of `effect-test`?
    //   "effect-test": path.join(__dirname, "packages/effect/test"),
    //   "effect": path.join(__dirname, "packages/effect/src"),
    // '@creative-introvert/tons-of-tests': path.join(__dirname, "packages", "tons-of-tests", "src"),
    //   ...alias("experimental"),
    //   ...alias("opentelemetry"),
    //   ...alias("platform"),
    //   ...alias("platform-node"),
    //   ...alias("platform-node-shared"),
    //   ...alias("platform-bun"),
    //   ...alias("platform-browser"),
    //   ...alias("printer"),
    //   ...alias("printer-ansi"),
    //   ...alias("rpc"),
    //   ...alias("rpc-http"),
    //   ...alias("schema"),
    //   ...alias("sql"),
    //   ...alias("sql-mssql"),
    //   ...alias("sql-mysql2"),
    //   ...alias("sql-pg"),
    //   ...alias("sql-sqlite-bun"),
    //   ...alias("sql-sqlite-node"),
    //   ...alias("sql-sqlite-react-native"),
    //   ...alias("sql-sqlite-wasm"),
    //   ...alias("typeclass"),
    //   ...alias("vitest")
    // }
  }
}

export default config
