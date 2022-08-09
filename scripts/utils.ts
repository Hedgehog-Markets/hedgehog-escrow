import fs from "fs";
import path from "path";
import process from "process";
import { spawnSync } from "child_process";

import toml from "toml";
import { Keypair, PublicKey } from "@solana/web3.js";

export const PROJECT_DIR = path.dirname(__dirname);
export const PROGRAMS_DIR = path.join(PROJECT_DIR, "programs");
export const DEPLOY_DIR = path.join(PROJECT_DIR, "target", "deploy");
export const ACCOUNTS_DIR = path.join(DEPLOY_DIR, "accounts");

export const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);

// https://github.com/solana-labs/solana/blob/aea84e699c904235b8d6406b9424c22449e8254f/sdk/program/src/rent.rs#L31
export const LAMPORTS_PER_BYTE_YEAR = Number(
  ((1_000_000_000n / 100n) * 365n) / (1024n * 1024n),
);

////////////////////////////////////////////////////////////////////////////////

type AnchorToml = {
  programs?: { localnet?: { [program: string]: string } };
  provider?: { wallet?: string };
  test?: {
    genesis?: [{ address: string; program: string }];
    validator?: {
      url?: string;
      account?: [{ address: string; filename: string }];
      clone?: [{ address: string }];
    };
  };
};

export const anchorToml: AnchorToml = (() => {
  const file = path.join(PROJECT_DIR, "Anchor.toml");
  try {
    const data = fs.readFileSync(file, "utf8");
    return toml.parse(data);
  } catch (e) {
    console.error(`error: could not read Anchor config file '${file}'`);
    process.exit(1);
  }
})();

export const walletPath = path.join(
  PROJECT_DIR,
  anchorToml?.provider?.wallet ?? __throw(new Error("missing provider wallet")),
);
export const wallet = readKeypair(walletPath);

////////////////////////////////////////////////////////////////////////////////

export class Program {
  readonly address: PublicKey;
  readonly pda: PublicKey;

  readonly accountPath: string;
  readonly exeAccountPath: string;

  constructor(readonly name: string, readonly lib: string) {
    this.address = new PublicKey(
      anchorToml.programs?.localnet?.[lib] ??
        __throw(new Error(`missing [program.localnet] entry for '${lib}'`)),
    );
    this.pda = PublicKey.findProgramAddressSync(
      [this.address.toBytes()],
      BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    )[0];

    this.accountPath = path.join(ACCOUNTS_DIR, `${lib}.json`);
    this.exeAccountPath = path.join(ACCOUNTS_DIR, `${lib}-exe.json`);
  }

  public toString(): string {
    return this.name;
  }

  public elf(): Buffer {
    return fs.readFileSync(path.join(DEPLOY_DIR, `${this.lib}.so`));
  }
}

export const programs = (() => {
  const programs = new Map<string, Program>();

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(PROGRAMS_DIR, { withFileTypes: true });
  } catch (e) {
    console.error(`error: could not read programs directory '${PROGRAMS_DIR}'`);
    process.exit(1);
  }

  let programNames = new Set<string>();
  for (const entry of entries) {
    if (entry.isDirectory()) {
      programNames.add(entry.name);
    }
  }

  const result = spawnSync("cargo", ["metadata"], {
    shell: false,
    stdio: "pipe",
    encoding: "utf8",
  });
  if (result.status !== 0) {
    console.error(`error: failed to fetch workspace metadata`);
    process.exit(1);
  }

  const metadata = JSON.parse(result.stdout);
  const packages =
    metadata?.packages ??
    __throw(new Error("missing 'packages' entry in workspace metadata"));

  if (!Array.isArray(packages)) {
    throw new Error("'packages' entry in workspace metadata is not an array");
  }

  for (const pkg of packages) {
    const name = pkg.name ?? __throw(new Error("missing package name"));
    if (programNames.delete(name)) {
      const lib =
        pkg.targets?.[0]?.name ??
        __throw(new Error("missing package target name"));

      const program = new Program(name, lib);
      programs.set(name, program);
    }
  }

  return programs;
})();

////////////////////////////////////////////////////////////////////////////////

let exitHandlers: Array<() => void> | undefined;

function exitHandler() {
  if (exitHandlers === undefined) {
    return;
  }

  // Take ownership of the exit handlers.
  const handlers = exitHandlers;
  exitHandlers = undefined;

  let callback;
  while ((callback = handlers.pop()) !== undefined) {
    callback();
  }
}

/**
 * Add a handler to be called on process exit.
 */
export function atexit(fn: () => void) {
  if (exitHandlers === undefined) {
    exitHandlers = [];

    process.once("SIGINT", exitHandler);
    process.once("SIGHUP", exitHandler);
    process.once("SIGQUIT", exitHandler);
    process.once("SIGTERM", exitHandler);
    process.once("uncaughtException", exitHandler);
    process.once("exit", exitHandler);
    process.once("beforeExit", exitHandler);
  }

  exitHandlers.push(fn);
}

////////////////////////////////////////////////////////////////////////////////

/**
 * Build a program.
 */
export function build(program: Program, verbose: boolean = false) {
  const args: string[] = ["build"];
  args.push("--program-name", program.lib); // Build lib.

  console.log(`Building ${program}`);

  const result = spawnSync("anchor", args, {
    shell: false,
    stdio: ["ignore", verbose ? "inherit" : "ignore", "inherit"],
  });
  if (result.status !== 0) {
    console.error(`error: failed to build ${program}`);
    process.exit(1);
  }

  console.log();

  fs.mkdirSync(ACCOUNTS_DIR, { recursive: true });

  // Write the account data for the program.
  {
    const data = Buffer.alloc(4 + 32);
    data.writeUint32LE(2, 0); // State: Program.
    data.set(program.pda.toBytes(), 4); // Program address.

    const accountData = JSON.stringify({
      pubkey: program.address.toBase58(),
      account: {
        lamports: minLamportsForRentExempt(data.length),
        data: [data.toString("base64"), "base64"],
        owner: BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58(),
        executable: true,
        rentEpoch: 0,
      },
    });

    fs.writeFileSync(program.accountPath, accountData);
  }

  // Write the account data for the executable.
  {
    const elf = program.elf();

    const data = Buffer.alloc(4 + 8 + 1 + 32 + elf.length);
    data.writeUint32LE(3, 0); // State: Program data.
    data.writeBigUint64LE(0n, 4); // Slot.
    data.writeUint8(1, 4 + 8); // Option::Some for upgrade authority.
    data.set(wallet.publicKey.toBytes(), 4 + 8 + 1); // Upgrade authority address.
    data.set(elf, 4 + 8 + 1 + 32); // Raw program data.

    const accountData = JSON.stringify({
      pubkey: program.pda.toBase58(),
      account: {
        lamports: minLamportsForRentExempt(data.length),
        data: [data.toString("base64"), "base64"],
        owner: BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58(),
        executable: false,
        rentEpoch: 0,
      },
    });

    fs.writeFileSync(program.exeAccountPath, accountData);
  }
}

////////////////////////////////////////////////////////////////////////////////

/**
 * Read a keypair from a JSON file.
 */
export function readKeypair(file: string): Keypair {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`error: could not read keypair file '${file}'`);
    process.exit(1);
  }

  if (
    !Array.isArray(data) ||
    data.length !== 64 ||
    !data.every((x) => typeof x === "number" && x >= 0 && x <= 255)
  ) {
    console.error(`error: invalid keypair file '${file}'`);
    process.exit(1);
  }

  const keypairBytes = new Uint8Array(64);
  keypairBytes.set(data);
  return Keypair.fromSecretKey(keypairBytes);
}

/**
 * Gets the minimum number of lamports to safely be rent exempt.
 */
export function minLamportsForRentExempt(size: number): number {
  return 2 * LAMPORTS_PER_BYTE_YEAR * (size + 128);
}

/**
 * Utility function to throw from an expression.
 */
export function __throw(error: Error): never {
  throw error;
}
