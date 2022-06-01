import * as anchor from '@project-serum/anchor';
import { Program } from '@project-serum/anchor';
import {
  Keypair,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import type { HhEscrow } from '../../target/types/hh_escrow';
import { intoU64BN } from '../u64';
import { createInitMintInstructions } from '../utils';
import {
  ErrorCode,
  InitializeMarketParams,
} from './utils';

// NOTE: These tests are flaky. To test interactions we generally aim to set the
// close timestamp to be the same as the timestamp when the market is
// initialized so we can immediately process an update on it.
//
// This is done by setting the timestamp to the upcoming block. If the
// instruction does not appear in that given block, the tests will fail.
describe('hh-escrow update state', () => {
  // Configure the client to use the local cluster.
  const provider = anchor.Provider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.HhEscrow as Program<HhEscrow>;
  const closeTs = BigInt(Date.now()) / 1000n + 3600n;
  const expiryTs = closeTs + 3600n;
  const resolver = Keypair.generate();
  const defaultMarketParams: InitializeMarketParams = {
    closeTs: intoU64BN(closeTs),
    expiryTs: intoU64BN(expiryTs),
    resolutionDelay: 3600,
    yesAmount: intoU64BN(0),
    noAmount: intoU64BN(0),
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
    [authority] = PublicKey.findProgramAddressSync(
      [Buffer.from('authority'), market.publicKey.toBuffer()],
      program.programId
    );
    [yesTokenAccount, yesNonce] = PublicKey.findProgramAddressSync(
      [Buffer.from('yes'), market.publicKey.toBuffer()],
      program.programId
    );
    [noTokenAccount, noNonce] = PublicKey.findProgramAddressSync(
      [Buffer.from('no'), market.publicKey.toBuffer()],
      program.programId
    );
  });

  it('fails to update status to yes if market has not expired', async () => {
    expect.assertions(1);
    const epochInfo = await provider.connection.getEpochInfo();
    const time = await provider.connection.getBlockTime(
      epochInfo.absoluteSlot + 1
    );

    if (!time) throw Error('No block time found!');

    const marketParams = {
      ...defaultMarketParams,
      closeTs: intoU64BN(time),
      expiryTs: intoU64BN(time + 3600),
    };

    const ix = await program.methods
      .initializeMarket(marketParams)
      .accounts({
        market: market.publicKey,
        tokenMint: mint.publicKey,
        authority,
        yesTokenAccount,
        noTokenAccount,
      })
      .instruction();

    await expect(
      program.methods
        .updateState({ outcome: { Yes: {} } })
        .accounts({
          market: market.publicKey,
          resolver: resolver.publicKey,
        })
        .signers([market, resolver])
        .preInstructions([ix])
        .rpc()
    ).rejects.toThrowProgramError(ErrorCode.InvalidTransition);
  });

  it('fails to update status to no if market has not expired', async () => {
    expect.assertions(1);
    const epochInfo = await provider.connection.getEpochInfo();
    const time = await provider.connection.getBlockTime(
      epochInfo.absoluteSlot + 1
    );

    if (!time) throw Error('No block time found!');

    const marketParams = {
      ...defaultMarketParams,
      closeTs: intoU64BN(time),
      expiryTs: intoU64BN(time + 3600),
    };

    const ix = await program.methods
      .initializeMarket(marketParams)
      .accounts({
        market: market.publicKey,
        tokenMint: mint.publicKey,
        authority,
        yesTokenAccount,
        noTokenAccount,
      })
      .instruction();

    await expect(
      program.methods
        .updateState({ outcome: { No: {} } })
        .accounts({
          market: market.publicKey,
          resolver: resolver.publicKey,
        })
        .signers([market, resolver])
        .preInstructions([ix])
        .rpc()
    ).rejects.toThrowProgramError(ErrorCode.InvalidTransition);
  });

  it('fails to update to non-final status without the resolver', async () => {
    expect.assertions(1);
    const epochInfo = await provider.connection.getEpochInfo();
    const time = await provider.connection.getBlockTime(
      epochInfo.absoluteSlot + 1
    );

    if (!time) throw Error('No block time found!');

    const marketParams = {
      ...defaultMarketParams,
      closeTs: intoU64BN(time),
      expiryTs: intoU64BN(time + 3600),
    };

    const ix = await program.methods
      .initializeMarket(marketParams)
      .accounts({
        market: market.publicKey,
        tokenMint: mint.publicKey,
        authority,
        yesTokenAccount,
        noTokenAccount,
      })
      .instruction();

    await expect(
      program.methods
        .updateState({ outcome: { Invalid: {} } })
        .accounts({
          market: market.publicKey,
          resolver: provider.wallet.publicKey,
        })
        .signers([market])
        .preInstructions([ix])
        .rpc()
    ).rejects.toThrowProgramError(ErrorCode.IncorrectResolver);
  });

  it('succeeds in updating status to invalid before market has expired', async () => {
    expect.assertions(2);
    const epochInfo = await provider.connection.getEpochInfo();
    const time = await provider.connection.getBlockTime(
      epochInfo.absoluteSlot + 1
    );

    if (!time) throw Error('No block time found!');

    const marketParams = {
      ...defaultMarketParams,
      closeTs: intoU64BN(time),
      expiryTs: intoU64BN(time + 3600),
    };

    const ix = await program.methods
      .initializeMarket(marketParams)
      .accounts({
        market: market.publicKey,
        tokenMint: mint.publicKey,
        authority,
        yesTokenAccount,
        noTokenAccount,
      })
      .instruction();

    await program.methods
      .updateState({ outcome: { Invalid: {} } })
      .accounts({
        market: market.publicKey,
        resolver: resolver.publicKey,
      })
      .signers([market, resolver])
      .preInstructions([ix])
      .rpc();

    const marketAccount = await program.account.market.fetch(market.publicKey);

    expect(marketAccount.outcomeTs).toEqualBN(time);
    expect(marketAccount.outcome).toStrictEqual({ Invalid: {} });
  });

  it('succeeds in updating status to open before market has expired', async () => {
    expect.assertions(2);
    const firstUpdateIx = await program.methods
      .updateState({ outcome: { Invalid: {} } })
      .accounts({
        market: market.publicKey,
        resolver: resolver.publicKey,
      })
      .signers([market, resolver])
      .instruction();

    const epochInfo = await provider.connection.getEpochInfo();
    const time = await provider.connection.getBlockTime(
      epochInfo.absoluteSlot + 1
    );

    if (!time) throw Error('No block time found!');

    const marketParams = {
      ...defaultMarketParams,
      closeTs: intoU64BN(time),
      expiryTs: intoU64BN(time + 3600),
    };

    const initializeIx = await program.methods
      .initializeMarket(marketParams)
      .accounts({
        market: market.publicKey,
        tokenMint: mint.publicKey,
        authority,
        yesTokenAccount,
        noTokenAccount,
      })
      .instruction();

    await program.methods
      .updateState({ outcome: { Open: {} } })
      .accounts({
        market: market.publicKey,
        resolver: resolver.publicKey,
      })
      .signers([market, resolver])
      .preInstructions([initializeIx, firstUpdateIx])
      .rpc();

    const marketAccount = await program.account.market.fetch(market.publicKey);

    expect(marketAccount.outcomeTs).toEqualBN(0);
    expect(marketAccount.outcome).toStrictEqual({ Open: {} });
  });

  it('succeeds in updating market status if the market has expired', async () => {
    expect.assertions(2);
    const updateIxs = [];
    let time;
    // Runs through all state updates.
    const states = ['Invalid', 'Yes', 'No'];
    for (let i = 0; i < states.length; i++) {
      if (i !== states.length - 1) {
        updateIxs.push(
          await program.methods
            .updateState({ outcome: { [states[i]]: {} } })
            .accounts({
              market: market.publicKey,
              resolver: resolver.publicKey,
            })
            .instruction()
        );

        continue;
      }
      const epochInfo = await provider.connection.getEpochInfo();
      time = await provider.connection.getBlockTime(
        epochInfo.absoluteSlot + 1
      );

      if (!time) throw Error('No block time found!');

      const marketParams = {
        ...defaultMarketParams,
        closeTs: intoU64BN(time),
        expiryTs: intoU64BN(time),
      };

      const ix = await program.methods
        .initializeMarket(marketParams)
        .accounts({
          market: market.publicKey,
          tokenMint: mint.publicKey,
          authority,
          yesTokenAccount,
          noTokenAccount,
        })
        .instruction();

      await program.methods
        .updateState({ outcome: { [states[i]]: {} } })
        .accounts({
          market: market.publicKey,
          resolver: resolver.publicKey,
        })
        .signers([market, resolver])
        .preInstructions([ix, ...updateIxs])
        .rpc();
    }

    const marketAccount = await program.account.market.fetch(market.publicKey);

    expect(marketAccount.outcomeTs).toEqualBN(time);
    expect(marketAccount.outcome).toStrictEqual({ No: {} });
  });

  it('fails to update market status to open if the market has expired', async () => {
    expect.assertions(1);

    const firstUpdateIx = await program.methods
      .updateState({ outcome: { Invalid: {} } })
      .accounts({
        market: market.publicKey,
        resolver: resolver.publicKey,
      })
      .signers([market, resolver])
      .instruction();

    const epochInfo = await provider.connection.getEpochInfo();
    const time = await provider.connection.getBlockTime(
      epochInfo.absoluteSlot + 1
    );

    if (!time) throw Error('No block time found!');

    const marketParams = {
      ...defaultMarketParams,
      closeTs: intoU64BN(time),
      expiryTs: intoU64BN(time),
    };

    const initializeIx = await program.methods
      .initializeMarket(marketParams)
      .accounts({
        market: market.publicKey,
        tokenMint: mint.publicKey,
        authority,
        yesTokenAccount,
        noTokenAccount,
      })
      .instruction();

    await expect(
      program.methods
        .updateState({ outcome: { Open: {} } })
        .accounts({
          market: market.publicKey,
          resolver: resolver.publicKey,
        })
        .signers([market, resolver])
        .preInstructions([initializeIx, firstUpdateIx])
        .rpc()
    ).rejects.toThrowProgramError(ErrorCode.InvalidTransition);
  });

  it('auto-finalizes without the resolver', async () => {
    expect.assertions(4);
    const epochInfo = await provider.connection.getEpochInfo();
    const time = await provider.connection.getBlockTime(
      epochInfo.absoluteSlot + 1
    );

    if (!time) throw Error('No block time found!');

    // The market should auto-finalize if the amount is not filled by the closed
    // time.
    const marketParams = {
      ...defaultMarketParams,
      closeTs: intoU64BN(time),
      expiryTs: intoU64BN(time),
      yesAmount: intoU64BN(1),
    };

    await program.methods
      .initializeMarket(marketParams)
      .accounts({
        market: market.publicKey,
        tokenMint: mint.publicKey,
        authority,
        yesTokenAccount,
        noTokenAccount,
      })
      .signers([market])
      .rpc();

    let marketAccount = await program.account.market.fetch(market.publicKey);

    expect(marketAccount.outcome).toStrictEqual({ Open: {} });
    expect(marketAccount.finalized).toBeFalsy();

    await program.methods
      .updateState({ outcome: { Open: {} } })
      .accounts({
        market: market.publicKey,
        resolver: provider.wallet.publicKey,
      })
      .rpc();

    marketAccount = await program.account.market.fetch(market.publicKey);

    expect(marketAccount.outcome).toStrictEqual({ Invalid: {} });
    expect(marketAccount.finalized).toBeTruthy();
  });
});
