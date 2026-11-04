import { createDAppKit } from '@mysten/dapp-kit-react';
import { SuiGrpcClient } from '@mysten/sui/grpc';
export const dAppKit = createDAppKit({
  networks: ['testnet'],
  createClient: network => new SuiGrpcClient({ network, baseUrl: 'https://fullnode.testnet.sui.io:443' }),
});
declare module '@mysten/dapp-kit-react' { interface Register { dAppKit: typeof dAppKit; } }
