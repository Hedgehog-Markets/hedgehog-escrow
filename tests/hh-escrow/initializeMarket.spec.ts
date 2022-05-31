import * as anchor from '@project-serum/anchor';
import * as assert from 'assert';
import { Program, ProgramError, LangErrorCode } from '@project-serum/anchor';
import {
  export_default,
  Keypair,
  PublicKey,
  SendTransactionError,
  Transaction,
} from '@solana/web3.js';
import type { HhEscrow } from '../../target/types/hh_escrow';
import { intoU64, intoU64BN } from '../u64';
import { createInitMintInstructions } from '../utils';
import {
  ErrorCode,
  InitializeMarketParams,
  interpretMarketResource,
} from './utils';
import { findProgramAddressSync } from '@project-serum/anchor/dist/cjs/utils/pubkey';

describe('hh-escrow', () => {
  // Configure the client to use the local cluster.
  const provider = anchor.Provider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.HhEscrow as Program<HhEscrow>;
  const closeTs = BigInt(Date.now()) / 1000n + 3600n;
  const expiryTs = closeTs + 3600n;
  const resolver = Keypair.generate();
  const initializeMarketParams: InitializeMarketParams = {
    closeTs: intoU64BN(closeTs),
    expiryTs: intoU64BN(expiryTs),
    resolutionDelay: 3600,
    yesAmount: intoU64BN(1_000_000),
    noAmount: intoU64BN(2_000_000),
    resolver: resolver.publicKey,
    uri: '0'.repeat(256),
  };
  const mint = Keypair.generate();
  let market: Keypair,
    authority: PublicKey,
    yesTokenAccount: PublicKey,
    yesNonce: number,
    noTokenAccount: PublicKey,
    noNonce: number;

  beforeAll(async () => {
    const mintIxs = await createInitMintInstructions({
      mint: mint.publicKey,
      mintAuthority: provider.wallet.publicKey,
      connection: provider.connection,
      payer: provider.wallet.publicKey,
    });

    await provider.send(new Transaction().add(...mintIxs), [mint]);
  });

  beforeEach(() => {
    market = Keypair.generate();
    [authority] = findProgramAddressSync(
      [Buffer.from('authority'), market.publicKey.toBuffer()],
      program.programId
    );
    [yesTokenAccount, yesNonce] = findProgramAddressSync(
      [Buffer.from('yes'), market.publicKey.toBuffer()],
      program.programId
    );
    [noTokenAccount, noNonce] = findProgramAddressSync(
      [Buffer.from('no'), market.publicKey.toBuffer()],
      program.programId
    );
  });

  it('initializes a market correctly', async () => {
    expect.assertions(18);

    await program.methods
      .initializeMarket(initializeMarketParams)
      .accounts({
        market: market.publicKey,
        tokenMint: mint.publicKey,
        authority,
        yesTokenAccount,
        noTokenAccount,
      })
      .signers([market])
      .rpc();

    const marketAccount = await program.account.market.fetch(market.publicKey);

    // TODO: Replace with utility assertions from common package.
    expect(marketAccount.creator).toEqualPubkey(provider.wallet.publicKey);
    expect(marketAccount.resolver).toEqualPubkey(resolver.publicKey);
    expect(marketAccount.tokenMint).toEqualPubkey(mint.publicKey);
    expect(marketAccount.yesTokenAccount).toEqualPubkey(yesTokenAccount);
    expect(marketAccount.noTokenAccount).toEqualPubkey(noTokenAccount);
    expect(
      marketAccount.yesAmount.eq(initializeMarketParams.yesAmount)
    ).toBeTruthy();
    expect(intoU64(marketAccount.yesFilled)).toBe(0n);
    expect(
      marketAccount.noAmount.eq(initializeMarketParams.noAmount)
    ).toBeTruthy();
    expect(intoU64(marketAccount.noFilled)).toBe(0n);
    expect(
      marketAccount.closeTs.eq(initializeMarketParams.closeTs)
    ).toBeTruthy();
    expect(
      marketAccount.expiryTs.eq(initializeMarketParams.expiryTs)
    ).toBeTruthy();
    expect(intoU64(marketAccount.outcomeTs)).toBe(0n);
    expect(marketAccount.resolutionDelay).toBe(
      initializeMarketParams.resolutionDelay
    );
    expect(marketAccount.outcome).toStrictEqual({ Open: {} });
    expect(marketAccount.finalized).toBe(false);
    expect(marketAccount.yesAccountBump).toBe(yesNonce);
    expect(marketAccount.noAccountBump).toBe(noNonce);
    expect(interpretMarketResource(marketAccount.uri)).toBe(
      initializeMarketParams.uri
    );
  });

  it('fails to initialize a market if the authority is incorrect', async () => {
    expect.assertions(1);

    try {
      await program.methods
        .initializeMarket(initializeMarketParams)
        .accounts({
          market: market.publicKey,
          tokenMint: mint.publicKey,
          authority: Keypair.generate().publicKey,
          yesTokenAccount,
          noTokenAccount,
        })
        .signers([market])
        .rpc();
    } catch (e: any) {
      expect(e.error.errorCode.number).toBe(LangErrorCode.ConstraintSeeds);
    }
  });

  it('fails to initialize a market if the yes token account is incorrect', async () => {
    expect.assertions(1);

    const [wrongYesTokenAccount] = findProgramAddressSync(
      [Buffer.from('fake')],
      program.programId
    );

    try {
      await program.methods
        .initializeMarket(initializeMarketParams)
        .accounts({
          market: market.publicKey,
          tokenMint: mint.publicKey,
          authority,
          yesTokenAccount: wrongYesTokenAccount,
          noTokenAccount,
        })
        .signers([market])
        .rpc();
    } catch (e) {
      expect(e).toBeInstanceOf(SendTransactionError);
    }
  });

  it('fails to initialize a market if the no token account is incorrect', async () => {
    expect.assertions(1);

    const [wrongNoTokenAccount] = findProgramAddressSync(
      [Buffer.from('fake')],
      program.programId
    );

    try {
      await program.methods
        .initializeMarket(initializeMarketParams)
        .accounts({
          market: market.publicKey,
          tokenMint: mint.publicKey,
          authority,
          yesTokenAccount,
          noTokenAccount: wrongNoTokenAccount,
        })
        .signers([market])
        .rpc();
    } catch (e) {
      expect(e).toBeInstanceOf(SendTransactionError);
    }
  });

  it('fails to initialize a market if the URI is too long', async () => {
    expect.assertions(1);

    const newMarketParams = {
      ...initializeMarketParams,
      uri: '0'.repeat(257),
    };

    await expect(
      program.methods
        .initializeMarket(newMarketParams)
        .accounts({
          market: market.publicKey,
          tokenMint: mint.publicKey,
          authority,
          yesTokenAccount,
          noTokenAccount: noTokenAccount,
        })
        .signers([market])
        .rpc()
    ).rejects.toThrowProgramError(ErrorCode.InvalidMarketResource);
  });

  it('fails to initialize a market if the close timestamp is before the current time', async () => {
    expect.assertions(1);

    const newMarketParams = {
      ...initializeMarketParams,
      closeTs: intoU64BN(0),
    };

    await expect(
      program.methods
        .initializeMarket(newMarketParams)
        .accounts({
          market: market.publicKey,
          tokenMint: mint.publicKey,
          authority,
          yesTokenAccount,
          noTokenAccount: noTokenAccount,
        })
        .signers([market])
        .rpc()
    ).rejects.toThrowProgramError(ErrorCode.InvalidCloseTimestamp);
  });

  it('fails to initialize a market if the expiry timestamp is before the close timestamp', async () => {
    expect.assertions(1);

    const newMarketParams = {
      ...initializeMarketParams,
      expiryTs: intoU64BN(0),
    };

    await expect(
      program.methods
        .initializeMarket(newMarketParams)
        .accounts({
          market: market.publicKey,
          tokenMint: mint.publicKey,
          authority,
          yesTokenAccount,
          noTokenAccount: noTokenAccount,
        })
        .signers([market])
        .rpc()
    ).rejects.toThrowProgramError(ErrorCode.InvalidExpiryTimestamp);
  });
});