#!/usr/bin/env -S ts-node --transpile-only

import type { Keypair } from "@solana/web3.js";

import fs from "fs";
import os from "os";
import path from "path";
import process from "process";
import { execFileSync } from "child_process";

import { Command } from "commander";
import {
  PROJECT_DIR,
  programs,
  anchorToml,
  wallet,
  atexit,
  build,
} from "./utils";

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

if (!opts.skipBuild) {
  for (const program of programs.values()) {
    build(program, verbose);
  }
}

startValidator(ledger, wallet);

////////////////////////////////////////////////////////////////////////////////

/**
 * Start a test validator.
 *
 * @param ledger Path to the ledger directory.
 * @param wallet Wallet to use for the validator mint.
 */
function startValidator(ledger: string, wallet: Keypair) {
  const args: string[] = [];
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
    args.push("--account", program.pda.toBase58(), program.exeAccountPath);
    args.push(
      "--account",
      program.idlAddress.toBase58(),
      program.idlAccountPath,
    );
  }

  execFileSync("solana-test-validator", args, {
    shell: false,
    stdio: "inherit",
  });
}
