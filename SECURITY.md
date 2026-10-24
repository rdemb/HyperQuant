# Security

HyperQuant is a static site (GitHub Pages) that uses public APIs only. It stores no keys, passwords or user data on the server side: plans, the journal and settings live only in the browser (`localStorage` and IndexedDB).

## Reporting a vulnerability

Do not report vulnerabilities in public issues. Use GitHub's private reporting: the **Security → Report a vulnerability** tab in the [rdemb/HyperQuant](https://github.com/rdemb/HyperQuant/security/advisories/new) repository.

Describe what and where (file, view, URL), how to reproduce the problem and what its impact could be. You will get a reply within a few business days.

## Scope

- the code in this repository and the site https://rdemb.github.io/HyperQuant/,
- the GitHub Actions workflows and public data fetching (`scripts/fetch-public-data.mjs`).

Out of scope: availability and data of external APIs (Hyperliquid, exchanges, public sources).
