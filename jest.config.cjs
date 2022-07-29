const path = require("path");

const { compilerOptions } = require("./tsconfig.json");

/** @type {import("@jest/types").Config.InitialOptions} */
module.exports = {
  verbose: true,

  testEnvironment: "node",

  setupFilesAfterEnv: [
    "jest-plugin-must-assert",
    "<rootDir>/tests/matchers.ts",
    "<rootDir>/tests/provider.ts",
  ],
  testMatch: ["**/tests/*.spec.ts", "**/tests/**/*.spec.ts"],

  // Having problems with ts-jest, so using @swc/jest instead.
  transform: {
    "^.+\\.ts$": [
      "@swc/jest",
      {
        jsc: {
          parser: {
            syntax: "typescript",
            dynamicImport: true,
          },
          target: "es2022",
          baseUrl: path.resolve(__dirname, compilerOptions.baseUrl),
          paths: compilerOptions.paths,
          keepClassNames: true,
        },
      },
    ],
  },

  testTimeout: 10_000,
  slowTestThreshold: 5_000,

  fakeTimers: {
    doNotFake: ["nextTick"],
    timerLimit: 5_000,
  },
};
