import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DAppKitProvider, useCurrentAccount, useCurrentWallet, useDAppKit } from '@mysten/dapp-kit-react';
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { dAppKit } from './dapp-kit.js';
import './style.css';

type Health = { network: string; memoryNetwork: string; fetchedAt: string; tatum: { status: string; checkpoint?: string }; walrus: { status: string } };
type Challenge = { id: string; message: string; expiresAt: number };
type Prepared = { id: string; actor: string; bytes: string; digest: string; expiresAt: number; action: string; gasBudgetMist: string; network: string; broadcasts: boolean };
async function api<T>(path: string, data?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { method: data === undefined ? 'GET' : 'POST',
    credentials: 'same-origin', ...(data === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Request failed');
  return result as T;
}
const short = (value?: string) => value ? `${value.slice(0, 10)}…${value.slice(-6)}` : 'Disconnected';
export function WalletCheck() {
  const account = useCurrentAccount(), wallet = useCurrentWallet(), kit = useDAppKit();
  const address = account?.address;
  const activeAddress = useRef(address); activeAddress.current = address;
  const [health, setHealth] = useState<Health>();
  const [actor, setActor] = useState<string>();
  const [challenge, setChallenge] = useState<Challenge>();
  const [prepared, setPrepared] = useState<Prepared>();
  const [message, setMessage] = useState('Connect a Sui wallet to begin the local compatibility check.');
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState<string>();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    let current = true;
    setActor(undefined); setChallenge(undefined); setPrepared(undefined); setVerified(undefined);
    api<{ actor: string | null }>('/session').then(async session => {
      if (!current) return;
      if (address && session.actor === address) setActor(address);
      else if (session.actor) await api('/auth/logout', {});
    }).catch(() => { if (current) setMessage('Start the local API to continue.'); });
    return () => { current = false; };
  }, [address]);
  useEffect(() => { api<Health>('/health').then(setHealth).catch(() => setMessage('Provider status unavailable. Check that the local API is running.')); }, []);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    try { await work(); } catch (error) { setPrepared(undefined); setMessage(error instanceof Error ? error.message : 'The wallet check failed. Retry when ready.'); }
    finally { setBusy(false); }
  }
  function sameWallet(expected: string) { if (activeAddress.current !== expected) throw new Error('Wallet account changed. Request a fresh preparation.'); }
  const authenticated = address && actor === address;
  return <>
    <header><a className="brand" href="/" aria-label="Janus"><img src="/brand/lockup.svg" alt="Janus"/></a><div className="header-right"><span className="badge">SUI TESTNET</span><ConnectButton /></div></header>
    <div className="shell"><aside><div className="eyebrow">BUILD / PHASE A</div><a className="nav active" href="#checks">Integration check</a><div className="rail-note">Restart-safe execution on Sui<br/><br/>Walrus Memory · Tatum</div></aside>
    <main id="checks"><div className="pagehead"><div><div className="eyebrow">JANUS / INTEGRATION LAB</div><h1>Connect. Verify. Recover.</h1><p>Check the real integrations before the handover workflow goes live.</p></div><span className="badge">LOCAL DEVELOPMENT</span></div>
      <div className="status-grid"><section><div className="eyebrow">CHAIN EVIDENCE</div><h2>Tatum / {health?.network ?? 'checking'}</h2><p>{health?.tatum.status ?? 'Fetching provider status…'}</p><code>Checkpoint {health?.tatum.checkpoint ?? '—'}</code></section>
      <section><div className="eyebrow">MEMORY ACCESS</div><h2>Walrus / {health?.memoryNetwork ?? 'checking'}</h2><p>{health?.walrus.status ?? 'Checking delegate access…'}</p><small>{health ? `Checked ${new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', timeStyle: 'medium' }).format(new Date(health.fetchedAt))} Africa/Lagos` : 'No cached success assumed'}</small></section></div>
      <div className="notice" role="status" aria-live="polite">{message}</div>
      <section><div className="step">01 / WALLET OWNERSHIP</div><h2>Authenticate your connected account</h2><p>Janus checks a single-use, expiring message signature. This step has no transaction fee.</p>
      <dl><div><dt>Wallet</dt><dd>{wallet?.name ?? 'Not connected'}</dd></div><div><dt>Account</dt><dd><code title={address}>{short(address)}</code></dd></div><div><dt>Session</dt><dd>{authenticated ? 'Wallet ownership verified' : 'Awaiting authentication'}</dd></div></dl>
      {!authenticated && <button disabled={!address || busy} onClick={() => run(async () => { const expected = address!; const result = await api<Challenge>('/auth/challenge', { actor: expected }); sameWallet(expected); setChallenge(result); setMessage('Review the authentication message, then sign it in your wallet.'); })}>Review authentication message</button>}
      {challenge && !authenticated && <div className="review"><pre>{challenge.message}</pre><button disabled={busy || !address || now >= challenge.expiresAt} onClick={() => run(async () => {
        const expected = address!; sameWallet(expected);
        const signed = await kit.signPersonalMessage({ message: new TextEncoder().encode(challenge.message), network: 'testnet' });
        sameWallet(expected);
        const result = await api<{ actor: string }>('/auth/verify', { id: challenge.id, signature: signed.signature });
        sameWallet(expected); setActor(result.actor); setChallenge(undefined); setMessage('Wallet ownership verified. You can now prepare the sign-only check.');
      })}>{now >= challenge.expiresAt ? 'Message expired — request a new one' : 'Sign authentication message'}</button></div>}
      {authenticated && <button className="secondary" disabled={busy} onClick={() => run(async () => { await api('/auth/logout', {}); setActor(undefined); setPrepared(undefined); setVerified(undefined); setMessage('Session ended.'); })}>End session</button>}
      </section>
      <section><div className="step">02 / SIGN-ONLY COMPATIBILITY</div><h2>Verify approved transaction bytes</h2><p>Prepare a testnet transaction that sends 1 MIST to your own address. Your wallet signs it, then the backend verifies the exact bytes, digest and signer.</p><p><strong>This check does not submit the transaction or spend gas.</strong> A funded testnet account is needed to build and simulate valid gas inputs.</p>
      <button disabled={!authenticated || busy || health?.tatum.status !== 'verified'} onClick={() => run(async () => {
        const expected = address!; setVerified(undefined);
        const result = await api<Prepared>('/wallet-check/prepare', {}); sameWallet(expected);
        if (result.actor !== expected || result.network !== 'testnet' || result.broadcasts !== false) throw new Error('Unexpected preparation. Signing blocked.');
        setPrepared(result); setMessage('Preparation simulated through Tatum. Review the details before signing.');
      })}>{busy ? 'Working…' : 'Prepare sign-only check'}</button>
      {prepared && <div className="review"><dl><div><dt>Action</dt><dd>{prepared.action}</dd></div><div><dt>Recipient</dt><dd><code className="full-id">{prepared.actor}</code></dd></div><div><dt>Network</dt><dd>Sui Testnet</dd></div><div><dt>Gas budget ceiling</dt><dd>0.01 testnet SUI · no execution in this check</dd></div><div><dt>Digest</dt><dd><code className="full-id">{prepared.digest}</code></dd></div><div><dt>Validity</dt><dd>{Math.max(0, Math.ceil((prepared.expiresAt - now) / 1000))} seconds</dd></div></dl>
      <button disabled={busy || !authenticated || now >= prepared.expiresAt} onClick={() => run(async () => {
        const expected = address!; sameWallet(expected);
        const signed = await kit.signTransaction({ transaction: prepared.bytes, network: 'testnet' });
        sameWallet(expected);
        const result = await api<{ status: string; digest: string; broadcast: boolean }>('/wallet-check/verify', { id: prepared.id, bytes: signed.bytes, signature: signed.signature });
        sameWallet(expected);
        if (result.broadcast || result.digest !== prepared.digest) throw new Error('Unexpected verification response');
        setVerified(result.digest); setPrepared(undefined); setMessage('Sign-only compatibility verified. No transaction was broadcast.');
      })}>{now >= prepared.expiresAt ? 'Preparation expired — prepare again' : 'Sign transaction without submitting'}</button><button className="secondary" disabled={busy} onClick={() => { setPrepared(undefined); setMessage('Signing preparation dismissed. Nothing was submitted.'); }}>Dismiss</button></div>}
      {verified && <div className="success"><strong>Exact bytes and signer verified</strong><code className="full-id">{verified}</code><p>No broadcast. This is wallet compatibility evidence, not a completed handover.</p></div>}
      </section>
      <footer>Integration build · Handover contract and recovery worker are not deployed.<br/>Never enter a seed phrase or delegate secret on this page.</footer>
    </main></div>
  </>;
}
