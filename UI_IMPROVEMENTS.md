# ERSELI — UI improvements (28 October 2026)

## Changed files

- `src/pages/TrackOrder.tsx`
  - Added a clear current-status panel and Arabic explanations for pending, accepted, picked-up, in-transit, delivered, and cancelled states.
  - Added a manual refresh action and the local time when the latest lookup completed.
  - Clarified that guest tracking uses the tracking token and that courier contact/location are not currently returned by the tracking API.
- `src/styles.css`
  - Added responsive visual treatment for the tracking status panel, step-by-step progress, refresh action, and improved order form/summary focus states.

## Order/courier workflow findings

The existing courier desk already offers claim/accept and sequential status progression through server RPCs. The guest tracking RPC (`get_guest_order`) currently returns order code, service, status, and creation time only. This UI update makes the handoff and progress clearer without inventing courier identity/contact details or changing database/security behavior.

To expose a courier to the customer later, implement and review a server-side response that only reveals approved fields after the order has been assigned, then update both account and guest tracking surfaces. No SQL or live Supabase changes were made here.

## Verification

- TypeScript TSX syntax transpilation for `src/pages/TrackOrder.tsx`: passed.
- Full `npm run build`: **not verified**. Dependency installation (`npm ci`) timed out in this environment, leaving no usable local Vite/TypeScript project dependencies. The attempted build failed because dependency type definitions were unavailable; this is an environment/dependency-install failure, not evidence that the full build passes.
- No live Supabase or end-to-end browser tests were run.
