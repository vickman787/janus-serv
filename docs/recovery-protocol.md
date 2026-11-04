# Recovery protocol

1. Authenticate a wallet with an origin/network/address-bound, single-use expiring
   challenge. Scope private reads and mutations to operation participants.
2. Read control, proposal and Clock through Tatum. Validate business identity,
   participant, revision and expiry. Refuse any unresolved older preparation.
3. Build and simulate exact bytes through the configured Tatum client.
4. Persist unsigned bytes/digest and a recoverable signed intent in Walrus. Await
   acknowledgment, then exact blob/hash/signature-verified retrieval. Only then
   return a wallet preparation, with a fresh two-minute approval window.
5. Wallet signs only. The server checks bytes, digest, signer and session binding,
   re-reads live inputs and expiry, and rejects stale or changed preparations.
6. Atomically change preparation from prepared to submitting before broadcasting.
   The signature is not retained. Broadcast those bytes through Tatum once.
7. Query the known digest and verify business state. A timeout or NOT_FOUND is
   unresolved. It never authorizes a differently signed replacement.
8. Store/retrieve the next hash-linked, signed Walrus checkpoint. If this fails
   after verified chain success, return chain-confirmed/memory-sync-pending and
   repair it using the known digest and Walrus intent. Do not re-execute.

## Crash handling

Before broadcast, an unsigned preparation can be explicitly discarded. Once it
enters submitting, it cannot be discarded as though nothing happened. Reconnect
and the worker inspect its known digest. Browser closure cannot revoke a broadcast.
A chain-confirmed step needs only memory repair. A completed checkpoint is detected
idempotently if the process died before updating its preparation bookkeeping.

Accepted memory-job IDs are stored before waiting. Revalidation can repair a
known pending job using its exact job/namespace/blob pointer. It does not guess
context from semantic search or a local cached checkpoint.

Leases last three minutes and heartbeat while a process is working. After an
unclean worker death, another process may have to wait for the lease to expire.
Tests terminate actual subprocesses and then explicitly expire the confirmed-dead
fixture lease to exercise restart behavior without adding three minutes per test.
The chain/memory used by those crash tests are explicit fixtures, not Mainnet proof.

## Tests versus live evidence

Crash-after-broadcast, crash-after-confirmation, crash-after-final-write, uncertain
pre-broadcast outcome, memory outage and changed-actor/revision cases are covered
locally. Live provider reads and one fresh-process Walrus probe have been verified.
A real extension-wallet two-party handover must still be exercised manually before
claiming the deployed workflow is verified. The app does not claim exactly-once
execution globally; contract transitions and known-digest recovery provide the
scoped guarantees described above.
