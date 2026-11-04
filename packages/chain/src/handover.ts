import { bcs } from '@mysten/sui/bcs';
import { Transaction } from '@mysten/sui/transactions';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { normalizeSuiAddress, toBase64 } from '@mysten/sui/utils';
export const ZERO = normalizeSuiAddress('0x0');
export const ControlBCS = bcs.struct('Control', { id: bcs.Address, administrator: bcs.Address, revision: bcs.u64(), pending_proposal: bcs.Address, counter: bcs.u64() });
export const ProposalBCS = bcs.struct('Proposal', { id: bcs.Address, control: bcs.Address, operation_id: bcs.string(), administrator: bcs.Address,
  successor: bcs.Address, revision: bcs.u64(), expires_at_ms: bcs.u64(), stage: bcs.u8() });
const ClockBCS = bcs.struct('Clock', { id: bcs.Address, timestamp_ms: bcs.u64() });
export const ControlCreatedBCS=bcs.struct('ControlCreated',{control:bcs.Address,administrator:bcs.Address});
export const TransitionBCS=bcs.struct('Transition',{control:bcs.Address,proposal:bcs.Address,operation_id:bcs.string(),revision:bcs.u64(),administrator:bcs.Address,successor:bcs.Address,expires_at_ms:bcs.u64(),stage:bcs.u8()});
export type Control = ReturnType<typeof ControlBCS.parse> & { version: string; digest: string };
export type Proposal = ReturnType<typeof ProposalBCS.parse> & { version: string; digest: string; previousTransaction: string | null };
export type Action = 'create' | 'propose' | 'accept' | 'cancel' | 'change_successor' | 'expire' | 'increment' | 'publish';
export class ChainAdapter {
  constructor(readonly client: SuiGrpcClient, public packageId: string) {}
  async control(id: string): Promise<Control> {
    const { object } = await this.client.getObject({ objectId: id, include: { content: true } });
    if (object.type !== `${this.packageId}::handover::Control`) throw new Error('Unsupported control object type');
    return { ...ControlBCS.parse(object.content), version: object.version, digest: object.digest };
  }
  async proposal(id: string): Promise<Proposal> {
    const { object } = await this.client.getObject({ objectId: id, include: { content: true, previousTransaction: true } });
    if (object.type !== `${this.packageId}::handover::Proposal`) throw new Error('Unsupported proposal object type');
    return { ...ProposalBCS.parse(object.content), version: object.version, digest: object.digest, previousTransaction: object.previousTransaction };
  }
  async clock() {
    const { object } = await this.client.getObject({ objectId: '0x6', include: { content: true } });
    return ClockBCS.parse(object.content).timestamp_ms;
  }
  async transaction(digest: string) {
    try {
      const r = await this.client.getTransaction({ digest, include: { effects: true, events: true, objectTypes: true } });
      const tx = r.Transaction ?? r.FailedTransaction;
      return { kind: r.Transaction ? 'success' as const : 'failure' as const, digest: tx.digest, checkpoint: tx.checkpoint, tx };
    } catch { return { kind: 'unknown' as const, digest }; }
  }
  async build(actor: string, action: Action, args: { control?: string; proposal?: string; revision?: string; successor?: string; expiresAtMs?: string; operationId?: string; modules?: string[]; dependencies?: string[] }) {
    const tx = new Transaction(); tx.setSender(actor); tx.setGasBudget(action === 'publish' ? 200_000_000 : 30_000_000);
    const target = `${this.packageId}::handover::${action}` as `${string}::${string}::${string}`;
    if (action === 'publish') { const cap = tx.publish({ modules: args.modules!, dependencies: args.dependencies! }); tx.transferObjects([cap], actor); }
    else if (action === 'create') tx.moveCall({ target });
    else if (action === 'increment') tx.moveCall({ target, arguments: [tx.object(args.control!)] });
    else if (action === 'propose') tx.moveCall({ target, arguments: [tx.object(args.control!), tx.pure.string(args.operationId!), tx.pure.address(args.successor!), tx.pure.u64(args.expiresAtMs!), tx.pure.u64(args.revision!), tx.object('0x6')] });
    else {
      const inputs = [tx.object(args.control!), tx.object(args.proposal!), tx.pure.u64(args.revision!)];
      if (action === 'change_successor') inputs.push(tx.pure.address(args.successor!));
      inputs.push(tx.object('0x6')); tx.moveCall({ target, arguments: inputs });
    }
    const bytes = await tx.build({ client: this.client });
    const simulation = await this.client.simulateTransaction({ transaction: bytes, checksEnabled: true, include: { effects: true } });
    if (!simulation.Transaction || simulation.gasPaymentMocked) throw new Error('Simulation refused. Check actor, revision, expiry and testnet gas funds.');
    const gas=simulation.Transaction.effects.gasUsed;const estimate=BigInt(gas.computationCost)+BigInt(gas.storageCost)-BigInt(gas.storageRebate);
    return { estimatedGasMist:(estimate>0n?estimate:0n).toString(), bytes: toBase64(bytes), digest: await Transaction.from(bytes).getDigest(), gasBudgetMist: action === 'publish' ? '200000000' : '30000000' };
  }
}
