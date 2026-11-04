# One-pass manual test

Use two Sui wallets/accounts, A (administrator) and B (successor), with testnet SUI.
Keep Walrus delegate credentials in `.env`; never import them into participant
wallets. All Sui transactions below are Testnet; Walrus records use Mainnet.

1. Open http://localhost:4310 in the browser with your Sui wallet installed.
2. Connect A, review the authentication message and sign it.
3. On Dashboard, review and wallet-publish the compiled package if not configured.
   Publication has a 0.2 testnet SUI budget ceiling. Other actions cap at 0.03.
4. New operation: create a demonstration control. Wait for verified completion,
   then select its object ID. Enter B, a future expiry within 30 days, and a label.
   Public browsing is optional and requires the explicit visibility checkbox.
5. Review proposal recipient/object/revision/expiry and wallet-sign. The cockpit
   should show awaiting acceptance with an actual transaction/effects reference.
6. Copy the recovery reference. Stop `dev:api` and restart it. Allow an expired
   worker lease up to three minutes if termination was unclean. Open the same URL.
   Revalidate: checkpoint context must come from Walrus, with current Tatum reads.
7. Switch wallet to B. The prior session/preparation should clear. Authenticate B.
   Review and sign acceptance. Verify completion, successor authority and effects.
8. Use B's admin-only counter action. Switch back to A; A must not have that action.
9. Create separate operations for cancellation, short expiry and successor change.
   Wrong actor/revision/expired proposals must refuse. Reject one wallet signature,
   then discard the unsigned preparation and prepare again. Rejection is not an
   onchain cancellation.
10. Memory: explicitly approve the review preference. Inspect its source record,
    then resume a different changed-successor operation/session. Check the applied
    checklist and refusal behavior. Revoke the preference and verify it stops
    applying. Approval/revocation must never weaken the contract rules.
11. Inspect Dashboard, Operations search/filter, Memory, Status and Guide at mobile
    width. Public observers should see only intentionally public operations.

If a transaction is unresolved, use Recover known digest; do not create a different
transaction to guess whether it failed. If chain success is verified but memory is
pending, retry recovery; no duplicate business action should be requested.

Report the page URL, action, displayed error/status and public transaction digest.
Do not send delegate keys, session cookies, wallet private keys or recovery phrases.

The test has not been represented as completed until you execute it. Production
hosting, ten meaningful operation/learning memories, public repository, video/blog
publication and final submission remain separate evidence/delivery requirements.

Successor-change review: the app deliberately keeps the original remembered baseline after a signed successor-change transaction. The cockpit must show mismatch and refuse acceptance until the administrator explicitly approves the reviewed live conditions. This is the real changed-proposal scenario for the saved checklist preference.

