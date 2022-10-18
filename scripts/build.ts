#!/usr/bin/env -S ts-node --transpile-only

import process from "process";

import { Command } from "commander";

import { Program, build, programs } from "./utils";

////////////////////////////////////////////////////////////////////////////////

// Get the script command line arguments.
const { verbose, targets } = (() => {
  type Opts = {
    verbose: boolean;
    programName?: string;
  };

  const program = new Command("build")
    .showHelpAfterError(true)
    .showSuggestionAfterError(true)
    .helpOption("-h, --help", "display this help message and exit")
    .option("-v, --verbose", "use verbose output", false)
    .option("-p, --program-name <PROGRAM_NAME>", "specify program to build", false)
    .parse();

  const { verbose, programName } = program.opts<Opts>();

  let targets: Array<Program>;
  if (programName) {
    const program = programs.get(programName);
    if (!program) {
      console.error(`error: program '${programName}' not found`);
      process.exit(1);
    }
    targets = [program];
  } else {
    targets = [...programs.values()];
  }

  return { verbose, targets };
})();

////////////////////////////////////////////////////////////////////////////////

(async () => {
  for (const program of targets) {
    await build(program, verbose);
  }
})().finally(() => process.exit());
