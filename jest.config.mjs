import path from "path";
import url from "url";

import chalk from "chalk";
import { pathsToModuleNameMapper } from "ts-jest";
import ts from "typescript";

/**
 * @typedef {import("jest").Config} JestConfig
 * @typedef {import("ts-jest").TsJestGlobalOptions} TsJestOptions
 */

const __dirname = url.fileURLToPath(new URL(".", import.meta.url));

const { options: compilerOptions } = await readTsConfig(path.resolve(__dirname, "tsconfig.json"));

/**
 * @param {string} file
 * @return {ts.ParsedCommandLine}
 */
async function readTsConfig(file) {
  const configJson = await ts.readJsonConfigFile(file, ts.sys.readFile);
  const config = ts.parseJsonSourceFileConfigFileContent(configJson, ts.sys, path.dirname(file));
  if (emitDiagnostics(config.errors)) {
    process.exit(1);
  }
  return config;
}

/**
 * @param {ts.Diagnostic | Array<ts.Diagnostic>} diagnostics
 * @returns {boolean}n
 */
function emitDiagnostics(diagnostics) {
  if (!Array.isArray(diagnostics)) {
    diagnostics = [diagnostics];
  }

  let error = false;

  diagnostics.forEach((diagnostic) => {
    let color = chalk.reset;
    switch (diagnostic.category) {
      case ts.DiagnosticCategory.Warning:
        color = chalk.yellow;
        break;
      case ts.DiagnosticCategory.Error:
        color = chalk.red;
        error = true;
        break;
      case ts.DiagnosticCategory.Suggestion:
        color = chalk.blue;
        break;
    }

    let message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    if (diagnostic.file) {
      const { line, character } = ts.getLineAndCharacterOfPosition(
        diagnostic.file,
        diagnostic.start,
      );
      message = `${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}`;
    }

    console.log(color(message));
  });

  return error;
}

/** @type {JestConfig} */
export default {
  forceExit: true,

  maxWorkers: 1,

  roots: ["<rootDir>/ts/"],
  setupFiles: ["dotenv/config"],
  setupFilesAfterEnv: ["<rootDir>/ts/setup/matchers.ts", "<rootDir>/ts/setup/provider.ts"],
  testMatch: ["**/__tests__/**/*.spec.ts"],

  transform: {
    /**
     * @type {[string, TsJestOptions]}
     */
    "\\.ts$": [
      "ts-jest",
      {
        isolatedModules: true,
      },
    ],
  },
  moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths, {
    prefix: path.resolve(__dirname, compilerOptions.baseUrl),
  }),

  testTimeout: 15_000,
  slowTestThreshold: 5_000,
};
