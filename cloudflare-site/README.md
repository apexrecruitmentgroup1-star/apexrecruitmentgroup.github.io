# Apex Global Services — Cloudflare migration

Standalone version of the existing Apex website: English/Arabic public pages, vacancies, proposals, candidate/client accounts, private uploads and administration. Source is in GitHub; runtime is Cloudflare Workers with D1 and private R2. This folder is the Cloudflare project root.

## Status

Source builds and passes TypeScript checks, Wrangler deployment dry run, and 71 isolated auth/security assertions. It is not yet a live migration. Cloudflare account sign-in, resource creation, runtime settings, production data transfer, and end-to-end verification remain required. Keep the existing site live until these finish.

## Cloudflare dashboard configuration

Connect this repository using Workers & Pages → Create application → Import a repository. Use:

| Setting | Value |
| --- | --- |
| Branch | `cloudflare-migration` |
| Root directory | `cloudflare-site` |
| Worker name | `apex-global-services` |
| Build command | `pnpm run build` |
| Deploy command | `pnpm run deploy` |

Wrangler declares D1 `DB` and R2 `BUCKET`; current Wrangler supports resource auto-provisioning on first deployment. R2 must be enabled in the account. Do not approve a paid plan or subscription without owner approval. The first deploy can create resources, but database migrations and runtime values are required before the application is usable. Record the actual D1 ID in `wrangler.jsonc` after provisioning.

Apply the `drizzle/*.sql` schema migrations with `pnpm run db:migrate`. For an existing-data import, follow the migration sequence below instead of assuming schema migrations copy data.

## Runtime settings

Set these in Cloudflare Worker Settings → Variables and Secrets:

- `SITE_URL`: the actual deployed HTTPS origin.
- `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`: retain the existing Supabase project. Never use a service-role key.
- `ADMIN_EMAIL` and `ADMIN_SUBJECT`: exact owner email and verified identity `supabase:<auth user UUID>`. Both must match. They bootstrap only an absent profile; they never reassign an existing profile by email.
- Optional `EMAIL_API_KEY` (secret) and `EMAIL_FROM` for Resend notifications.

Keep secrets in Cloudflare, never GitHub files. `.env.example` is blank. Configure Supabase's redirect allowlist for the new `/account` confirmation/recovery URLs while preserving the current site's URLs. Verify SMTP and confirmation delivery; do not turn off email confirmation.

## Sign-in migration

Independent Cloudflare Workers do not have ChatGPT's trusted identity gateway. Arbitrary `oai-authenticated-user-*` headers are ignored. Email sessions are verified with Supabase `getUser()`. ChatGPT sign-in is removed from the account page.

Existing email identities keep access when D1's `auth_identities` mappings and users are copied. Before cutover, link any ChatGPT-only profiles to verified Supabase identities through the old site's authenticated linking flow. Staff/admin profiles must not be automatically claimed by matching an email. If linking is unavailable, the owner must verify both IDs before an explicit database mapping. Do not create duplicate admin/candidate records as a workaround.

## Data migration and cutover

1. Inventory and securely export the live D1 tables. Do not commit any records, CVs, SQL dumps, or credentials to this public repository.
2. Copy the D1 schema and all rows with original IDs and relationships to the new account. Import into an empty destination and compare table counts; validate complete, untruncated values. Schema migration alone does not transfer records.
3. Copy all R2 objects using the original keys and content metadata. Keep the bucket private; the existing API enforces document permissions.
4. Preserve current content settings and published vacancies. The included public-content seed is only a fallback for a new database.
5. Configure the verified identities and runtime settings. Test owner, recruiter, candidate and client access, password reset/confirmation, uploads/download authorization, applications, proposals and enquiry delivery.
6. Freeze writes on the old host for the final synchronized export/import; verify counts and objects again before switching the published URL or DNS. Keep the old host available for rollback until the new deployment passes all checks.

## Local validation

Use Node 22+ and the package manager version in `package.json`:

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm run build
pnpm test
pnpm exec wrangler deploy --dry-run
```

The auth suite uses isolated local D1/R2 and mocked Supabase HTTP. It verifies PKCE, secure cookies, provider identity, roles, exact owner identity, rejection of forged platform headers and rejection of email-only legacy-account takeover. It does not send real emails or exercise production sign-in.
