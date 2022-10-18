#!/usr/bin/env -S ts-node --transpile-only

import { spawnSync } from "child_process";
import os from "os";
import path from "path";
import process from "process";

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
} from "./utils";

import type { Keypair } from "@solana/web3.js";

// Default is 64, this makes transactions faster.
const TICKS_PER_SLOT = 8;

const RPC_PORT = 8899;

const TMP_LEDGER_PREFIX = `hh-test-deploy.${process.pid}.`;

////////////////////////////////////////////////////////////////////////////////

// Get the script command line arguments.
const { verbose, opts } = (() => {
  type Opts = {
    verbose: boolean;
    skipBuild: boolean;
  };

  const program = new Command("validator")
    .showHelpAfterError(true)
    .showSuggestionAfterError(true)
    .helpOption("-h, --help", "display this help message and exit")
    .option("-v, --verbose", "use verbose output", false)
    .option("--skip-build", "skip building programs", false)
    .parse();

  const { verbose, skipBuild } = program.opts<Opts>();

  return { verbose, opts: { skipBuild } };
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

////////////////////////////////////////////////////////////////////////////////

void (async () => {
  if (!opts.skipBuild) {
    for (const program of programs.values()) {
      await build(program, verbose);
    }
  }
  await fetchSwitchboard();

  startValidator(ledger, wallet);
})()
  .catch((err) => {
    console.error(String(err));
    process.exitCode = 1;
  })
  .finally(() => process.exit());

////////////////////////////////////////////////////////////////////////////////

/**
 * Start a test validator.
 *
 * @param ledger Path to the ledger directory.
 * @param wallet Wallet to use for the validator mint.
 */
function startValidator(ledger: string, wallet: Keypair): void {
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

  const result = spawnSync("solana-test-validator", args, {
    shell: false,
    stdio: "inherit",
  });

  if (result.status) {
    if (verbose) {
      const logFile = path.join(ledger, "validator.log");
      try {
        const log = fs.readFileSync(logFile, "utf8");
        console.debug(log);
      } catch (_) {
        // noop
      }
    }

    throw new Error(`Solana test validator returned a non-zero exit code: ${result.status}`);
  }
}
