# Prior work and attribution

Janus Sui is a separate build in `C:/Projects/Janus-sui`, started 28 October 2026.
Original Janus: https://github.com/vickman787/janus, pinned commit
`7c8dfd46d9bf35609904f8a46a4be43dfa13d1ed` (MIT, copyright 2026 vickman787).
The original license is retained in `LICENSE`.

Reused unchanged: nine SVG files (including the six specified assets) from `brand/`, copied to `public/brand/`.
Inspected: original `base.html`, `cockpit.html`, and Python reconciler for navigation,
comparison hierarchy and behavioral reference. The Sui TypeScript code is new.
No old operation data, payout address, deployment values or secrets are imported.
The original repository, deployment and stored data have not been modified.

The new reconciler explicitly treats unresolved transaction outcomes as blocking;
pending state alone does not establish that a prior broadcast failed.
