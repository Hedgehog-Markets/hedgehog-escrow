import * as anchor from '@project-serum/anchor';
import * as assert from 'assert';
import { Program, ProgramError, LangErrorCode } from '@project-serum/anchor';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
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

  before(async () => {
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
    assert.ok(marketAccount.creator.equals(provider.wallet.publicKey));
    assert.ok(marketAccount.resolver.equals(resolver.publicKey));
    assert.ok(marketAccount.tokenMint.equals(mint.publicKey));
    assert.ok(marketAccount.yesTokenAccount.equals(yesTokenAccount));
    assert.ok(marketAccount.noTokenAccount.equals(noTokenAccount));
    assert.ok(marketAccount.yesAmount.eq(initializeMarketParams.yesAmount));
    assert.strictEqual(intoU64(marketAccount.yesFilled), 0n);
    assert.ok(marketAccount.noAmount.eq(initializeMarketParams.noAmount));
    assert.strictEqual(intoU64(marketAccount.noFilled), 0n);
    assert.ok(marketAccount.closeTs.eq(initializeMarketParams.closeTs));
    assert.ok(marketAccount.expiryTs.eq(initializeMarketParams.expiryTs));
    assert.strictEqual(intoU64(marketAccount.outcomeTs), 0n);
    assert.strictEqual(
      marketAccount.resolutionDelay,
      initializeMarketParams.resolutionDelay
    );
    assert.deepStrictEqual(marketAccount.outcome, { Open: {} });
    assert.strictEqual(marketAccount.finalized, false);
    assert.strictEqual(marketAccount.yesAccountBump, yesNonce);
    assert.strictEqual(marketAccount.noAccountBump, noNonce);
    assert.strictEqual(
      interpretMarketResource(marketAccount.uri),
      initializeMarketParams.uri
    );
  });

  it('fails to initialize a market if the authority is incorrect', async () => {
    await assert.rejects(
      async () => {
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
      },
      (err: any) => {
        assert.strictEqual(
          err.error.errorCode.number,
          LangErrorCode.ConstraintSeeds
        );
        return true;
      }
    );
  });

  it('fails to initialize a market if the yes token account is incorrect', async () => {
    const [wrongYesTokenAccount] = findProgramAddressSync(
      [Buffer.from('fake')],
      program.programId
    );
    await assert.rejects(async () => {
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
    });
  });

  it('fails to initialize a market if the no token account is incorrect', async () => {
    const [wrongNoTokenAccount] = findProgramAddressSync(
      [Buffer.from('fake')],
      program.programId
    );
    await assert.rejects(async () => {
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
    });
  });

  it('fails to initialize a market if the URI is too long', async () => {
    const newMarketParams = {
      ...initializeMarketParams,
      uri: '0'.repeat(257),
    };
    await assert.rejects(
      async () => {
        await program.methods
          .initializeMarket(newMarketParams)
          .accounts({
            market: market.publicKey,
            tokenMint: mint.publicKey,
            authority,
            yesTokenAccount,
            noTokenAccount: noTokenAccount,
          })
          .signers([market])
          .rpc();
      },
      (err: ProgramError) => {
        assert.strictEqual(err.code, ErrorCode.InvalidMarketResource);
        return true;
      }
    );
  });

  it('fails to initialize a market if the close timestamp is before the current time', async () => {
    const newMarketParams = {
      ...initializeMarketParams,
      closeTs: intoU64BN(0),
    };
    await assert.rejects(
      async () => {
        await program.methods
          .initializeMarket(newMarketParams)
          .accounts({
            market: market.publicKey,
            tokenMint: mint.publicKey,
            authority,
            yesTokenAccount,
            noTokenAccount: noTokenAccount,
          })
          .signers([market])
          .rpc();
      },
      (err: ProgramError) => {
        assert.strictEqual(err.code, ErrorCode.InvalidCloseTimestamp);
        return true;
      }
    );
  });

  it('fails to initialize a market if the expiry timestamp is before the close timestamp', async () => {
    const newMarketParams = {
      ...initializeMarketParams,
      expiryTs: intoU64BN(0),
    };
    await assert.rejects(
      async () => {
        await program.methods
          .initializeMarket(newMarketParams)
          .accounts({
            market: market.publicKey,
            tokenMint: mint.publicKey,
            authority,
            yesTokenAccount,
            noTokenAccount: noTokenAccount,
          })
          .signers([market])
          .rpc();
      },
      (err: ProgramError) => {
        assert.strictEqual(err.code, ErrorCode.InvalidExpiryTimestamp);
        return true;
      }
    );
  });
});
