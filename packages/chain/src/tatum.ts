import { UnaryCall, type RpcInterceptor } from '@protobuf-ts/runtime-rpc';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { GrpcTransport } from '@protobuf-ts/grpc-transport';
import { ChannelCredentials } from '@grpc/grpc-js';
import { z } from 'zod';


// Pace request starts across the shared client; never retry a transaction submission.
export function pacedRpcRequests(gapMs = 600): RpcInterceptor {
  let queue = Promise.resolve(), nextStart = 0;
  return { interceptUnary(next, method, input, options) {
    const started = queue.then(async () => {
      const wait = Math.max(0, nextStart - Date.now());
      if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      nextStart = Date.now() + gapMs;
      return { call: next(method, input, options) };
    });
    queue = started.then(() => undefined, () => undefined);
    return new UnaryCall(method, options.meta ?? {}, input,
      started.then(({call}) => call.headers), started.then(({call}) => call.response),
      started.then(({call}) => call.status), started.then(({call}) => call.trailers));
  }};
}
export function isProviderRateLimit(error: unknown) {
  const e = error as {status?:number;code?:string|number;message?:string}|null;
  return !!e && (e.status===429 || e.code===8 || e.code==='RESOURCE_EXHAUSTED' || /HTTP status code 429/.test(e.message??''));
}

export function createTatumClient(env: NodeJS.ProcessEnv = process.env) {
  const network = z.enum(['mainnet', 'testnet']).parse(env.SUI_NETWORK ?? 'testnet');
  const endpoint = new URL(env.TATUM_SUI_GRPC_URL ?? `https://sui-${network}-grpc.gateway.tatum.io`);
  if (endpoint.protocol !== 'https:' || endpoint.hostname !== `sui-${network}-grpc.gateway.tatum.io`
    || !['', '443'].includes(endpoint.port) || endpoint.pathname !== '/' || endpoint.search || endpoint.username || endpoint.password || endpoint.hash) {
    throw new Error('Tatum endpoint must be the official HTTPS gateway matching SUI_NETWORK');
  }
  const key = z.string().trim().min(1, 'Missing TATUM_API_KEY').parse(env.TATUM_API_KEY);
  const transport = new GrpcTransport({ host: endpoint.host, channelCredentials: ChannelCredentials.createSsl(),
    meta: { 'x-api-key': key }, timeout: 15_000, interceptors: [pacedRpcRequests()] });
  return { client: new SuiGrpcClient({ network, transport }), close: () => transport.close() };
}

// A single NOT_FOUND, timeout, or pruned transaction is always unresolved.
export async function inspectTransaction(client: SuiGrpcClient, digest: string) {
  try {
    const result = await client.getTransaction({ digest, include: { effects: true } });
    if (result.Transaction) return { kind: 'success' as const, digest: result.Transaction.digest };
    if (result.FailedTransaction) return { kind: 'failure' as const, digest: result.FailedTransaction.digest };
    return { kind: 'unknown' as const };
  } catch { return { kind: 'unknown' as const }; }
}
