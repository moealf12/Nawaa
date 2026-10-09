# Jina Reader: zero-spend pilot configuration

This feature is for controlled source-discovery experiments, not customer search.
The existing reader implementation lives at server/jina-reader.mjs and
security tests are at tests/jina-reader.test.mjs.

## Secure environment variables (Render preview only)

- JINA_API_KEY: add in Render environment configuration, never commit a value.
- JINA_READER_ENABLED: 0 initially; set to 1 only for a deliberate experiment.
- JINA_READER_ALLOWED_HOSTS: comma-separated exact hostnames approved for testing.
- JINA_READER_REQUESTS_PER_HOUR: 3 for the pilot (per-process, not account-wide).

## Safety guarantees and limitations

- The source reader is not wired into /api/search or /api/pilot/source-search.
- It accepts HTTPS only and refuses IP literals, localhost and non-allowlisted hosts.
- It neither verifies prices nor certifies product identity. Output is untrusted.
- Jina authenticated calls can spend finite free token credits.
- Never store a credit card, enable automatic recharging or add paid service plans.
- Use the Jina dashboard to verify the token quota before live activation.
- The per-process cap is not an account-wide quota. Multiple workers need a shared budget.
- Never expose a public unrestricted API proxy for this reader.

## Validation

Run node --test tests/jina-reader.test.mjs to validate the adapter locally.
Live token validity has not been proven solely by saving the environment variable.
