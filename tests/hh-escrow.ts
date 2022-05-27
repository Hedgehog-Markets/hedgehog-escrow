import * as anchor from '@project-serum/anchor';
import { Program } from '@project-serum/anchor';
import { HhEscrow } from '../target/types/hh_escrow';

describe('hh-escrow', () => {

  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.Provider.env());

  const program = anchor.workspace.HhEscrow as Program<HhEscrow>;

  it('Is initialized!', async () => {
    // Add your test here.
    const tx = await program.rpc.initialize({});
    console.log("Your transaction signature", tx);
  });
});
