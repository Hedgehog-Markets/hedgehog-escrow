#!/usr/bin/env -S ts-node --transpile-only

import { spawn } from "child_process";
import os from "os";
import path from "path";
import process from "process";

import { Connection, Keypair } from "@solana/web3.js";
import { Command } from "commander";
import fs from "graceful-fs";

import {
  PROJECT_DIR,
  anchorToml,
  atexit,
  build,
  fetchSwitchboard,
  programs,
  switchboard,
  wallet,
  walletPath,
} from "./utils";

// Default is 64, this makes transactions faster.
const TICKS_PER_SLOT = 8;

const LOCALHOST = "http://127.0.0.1";
const RPC_PORT = 8899;
const CLUSTER = `${LOCALHOST}:${RPC_PORT}`;

const STARTUP_TIMEOUT_MS = 10_000;
const STARTUP_TIMEOUT_NS = BigInt(STARTUP_TIMEOUT_MS) * 1_000_000n;

const TMP_LEDGER_PREFIX = `hh-test-deploy.${process.pid}.`;

////////////////////////////////////////////////////////////////////////////////

// Get the script command line arguments.
const { verbose, opts, tests } = (() => {
  type Opts = {
    verbose: boolean;
    grep?: string;
    skipBuild: boolean;
    skipFlaky: boolean;
  };
  type Args = [Array<string>];

  const program = new Command("test")
    .showHelpAfterError(true)
    .showSuggestionAfterError(true)
    .helpOption("-h, --help", "display this help message and exit")
    .option("-v, --verbose", "use verbose output", false)
    .option("--grep <SEARCH>", "run tests matching the search string")
    .option("--skip-build", "skip building programs", false)
    .option("--skip-flaky", "skip flaky tests", false)
    .argument("[test...]", "test files to run")
    .parse();

  const { verbose, grep, skipBuild, skipFlaky } = program.opts<Opts>();
  const [tests] = program.processedArgs as Args;

  return { verbose, opts: { grep, skipBuild, skipFlaky }, tests };
})();

////////////////////////////////////////////////////////////////////////////////

// Make a temporary ledger directory for the test validator.
const ledger = fs.mkdtempSync(path.join(os.tmpdir(), TMP_LEDGER_PREFIX));

// Delete the temporary directory when the process exits.
atexit(() => {
  try {
    fs.rmSync(ledger, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 10,
    });
  } catch (e) {
    console.warn(`warning: failed to clean up ledger at '${ledger}'`);
  }
});

if (verbose) {
  console.debug(`Wallet: ${wallet.publicKey.toBase58()}`);
  console.debug(`Ledger: ${ledger}\n`);
}

////////////////////////////////////////////////////////////////////////////////

void (async () => {
  if (!opts.skipBuild) {
    for (const program of programs.values()) {
      await build(program, verbose);
    }
  }
  await fetchSwitchboard();

  await startValidator(ledger, wallet);

  {
    const jest = require.resolve("jest/bin/jest");
    const args = [];

    if (verbose) {
      args.push("--verbose");
    }
    if (opts.grep !== undefined) {
      args.push("--testNamePattern", opts.grep);
    }

    args.push("--", ...tests);

    spawn(jest, args, {
      stdio: "inherit",
      env: {
        ...process.env,
        ANCHOR_PROVIDER_URL: `${LOCALHOST}:${RPC_PORT}`,
        ANCHOR_WALLET: walletPath,
        SKIP_FLAKY: opts.skipFlaky ? "1" : undefined,
      },
    }).on("exit", (code) => process.exit(code ?? 1));
  }
})();

////////////////////////////////////////////////////////////////////////////////

/**
 * Start a test validator.
 *
 * @param ledger Path to the ledger directory.
 * @param wallet Wallet to use for the validator mint.
 */
function startValidator(ledger: string, wallet: Keypair): Promise<void> {
  const args: Array<string> = [];
  args.push("--ledger", ledger);
  args.push("--mint", wallet.publicKey.toBase58());
  args.push("--rpc-port", RPC_PORT.toString());
  args.push("--ticks-per-slot", TICKS_PER_SLOT.toString());

  // Url to fetch cloned accounts from.
  args.push("--url", anchorToml?.test?.validator?.url ?? "devnet");

  {
    const accountEntries = anchorToml?.test?.validator?.account ?? [];
    for (const { address, filename } of accountEntries) {
      const filePath = path.join(PROJECT_DIR, filename);
      args.push("--account", address, filePath);
    }
  }
  {
    const cloneEntries = anchorToml?.test?.validator?.clone ?? [];
    for (const { address } of cloneEntries) {
      args.push("--clone", address);
    }
  }
  {
    const genesisEntries = anchorToml?.test?.genesis ?? [];
    for (const { address, program } of genesisEntries) {
      const programPath = path.join(PROJECT_DIR, program);
      args.push("--bpf-program", address, programPath);
    }
  }

  // Load the program data as accounts to simulate deployed programs.
  for (const program of programs.values()) {
    args.push("--account", program.address.toBase58(), program.accountPath);
    args.push("--account", program.exeAddress.toBase58(), program.exeAccountPath);
    args.push("--account", program.idlAddress.toBase58(), program.idlAccountPath);
  }

  // Load the Switchboard program.
  {
    args.push("--account", switchboard.address.toBase58(), switchboard.accountPath);
    args.push("--account", switchboard.exeAddress.toBase58(), switchboard.exeAccountPath);
    args.push("--account", switchboard.idlAddress.toBase58(), switchboard.idlAccountPath);
  }

  const validator = spawn("solana-test-validator", args, { shell: false });

  // Kill the test validator when the process exits.
  atexit(() => {
    if (!validator.killed && validator.exitCode === null) {
      validator.removeAllListeners();
      validator.kill("SIGKILL");
    }
  });

  // Stop the script if the test validator exits early.
  validator.once("exit", (code) => {
    if (!validator.killed) {
      console.error(`error: test validator exited early with code ${code}`);

      if (verbose) {
        const logFile = path.join(ledger, "validator.log");
        try {
          const log = fs.readFileSync(logFile, "utf8");
          console.debug(log);
        } catch (_) {
          // noop
        }
      } else {
        console.info("hint: try with --verbose to see the logs");
      }

      process.exit(1);
    }
  });

  return waitForValidator();
}

/**
 * Wait for the test validator to start.
 */
function waitForValidator(): Promise<void> {
  if (verbose) {
    console.debug(`Waiting for validator on ${CLUSTER} to start...\n`);
  }

  return new Promise((resolve) => {
    const conn = new Connection(CLUSTER);

    const exited = new Promise((_, reject) => atexit(() => reject("exited")));
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject("timeout"), STARTUP_TIMEOUT_MS),
    );

    const end = process.hrtime.bigint() + STARTUP_TIMEOUT_NS;

    const wait = (): Promise<void> =>
      Promise.race([exited, timeout, conn.getLatestBlockhash()])
        .then(() => resolve(undefined))
        .catch((reason) => {
          if (reason === "exited") {
            process.exit();
          }

          if (reason === "timeout" || process.hrtime.bigint() >= end) {
            console.error("error: test validator does not appear to be running");
            process.exit(1);
          }
          setTimeout(wait, 1);
        });

    void wait();
  });
}
