# Prompt to continue Erseli

Act as a senior full-stack engineer, product designer, and security-minded technical lead. Continue the existing Erseli PWA repository; do not replace it with a static mockup.

## Product
Erseli (إرسلي) is an Arabic-first, RTL delivery platform for Algeria. Start in one city and expand later. Services: restaurant food delivery, parcels/personal items, shopping pickup, and local delivery for shops/businesses. Couriers may use motorcycles or cars. The product must work responsively on desktop, Android, and iPhone as a PWA.

## Existing stack
- React + TypeScript + Vite
- Supabase Auth + Postgres + Row Level Security
- PWA manifest and service worker
- Arabic RTL UI, DZD currency
- Current scaffold is a starter only; it is not production-ready.

## Required deliverables
1. Inspect every existing file before making changes.
2. Preserve the current visual identity: deep forest green, lime accent, warm off-white, polished modern Arabic UI.
3. Build separate customer, courier, and admin experiences with role-based routing and real authentication.
4. Complete the database migrations, triggers, constraints, RLS policies, and indexes.
5. Create customer signup/login, profile, new order, order list, order detail, cancellation rules, and status timeline.
6. Create courier application form, private document upload, admin verification, availability toggle, nearby/available jobs, atomic accept-job operation, pickup/delivery status updates, and earnings history.
7. Create a real admin dashboard with protected routes, order management, courier verification, service areas, pricing rules, commissions, complaints, and audit log.
8. Build pricing as a configurable server-validated formula. Never trust a price calculated only in the browser.
9. Add map provider abstraction for pickup/dropoff address selection and distance estimates. Do not expose secret API keys in client code.
10. Add notifications with graceful fallback; document iOS PWA limitations.
11. Add Arabic-first UX and optional French. Use accessible labels, loading states, empty states, validation, error handling, and mobile-friendly layouts.
12. Add automated tests for order status transitions, role permissions, pricing, and double-accept race conditions.
13. Provide `.env.example`, setup instructions, migrations, seed/demo data, deployment instructions, and a final list of remaining production tasks.

## Security requirements
- Never put Supabase service-role keys or private secrets in frontend environment variables.
- Never let a user set their own role to admin or self-verify courier status.
- Enforce all authorization in the database/server, not only by hiding UI.
- Use RLS and test unauthorized reads/writes.
- Keep identity/license documents in private storage buckets with short-lived signed URLs and strict policies.
- Validate user input server-side and rate-limit sensitive actions.
- Add audit logs for admin changes and order status transitions.
- Do not claim a feature works unless implemented and tested.

## Business and legal assumptions
- Launch in one Algerian city selected by the founder.
- Currency is DZD.
- Start with cash on delivery if the founder confirms this is operationally and legally appropriate; keep payments modular.
- Do not assume a specific city, delivery fee, commission, local payment provider, or legal approval. Use configurable settings and ask only for decisions that truly block implementation.
- Add prohibited/restricted item rules and terms/privacy placeholders that must be reviewed locally before launch.

## Workflow
Work in small coherent steps:
A. Audit the repository and list gaps.
B. Implement authentication and secure database foundations.
C. Implement end-to-end customer order creation and status timeline.
D. Implement courier workflow and atomic assignment.
E. Implement admin controls and audit trail.
F. Add maps, pricing, notifications, tests, and deployment docs.
G. Run typecheck/build/tests; fix all errors and report what was actually verified.

Do not stop after writing a plan. Make code changes in the repository, explain changed files, and identify any required external credentials or founder decisions.
