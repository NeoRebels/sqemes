# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities **privately** — do **not** open a public issue.

Email **ufuk@neorebels.com** with:

- a description of the issue and its impact,
- steps to reproduce (a proof of concept if possible),
- the affected version / commit.

We'll acknowledge within a few business days and keep you updated on the fix. Please give us
reasonable time to release a fix before any public disclosure.

## Scope

This repository is the self-hostable open core. When you self-host, you are responsible for
your own deployment's secrets, TLS, and infrastructure hardening — see
[SELF_HOSTING.md](./SELF_HOSTING.md). The bundled `selfhost/.env.example` ships with
**placeholder** secrets that you must change before exposing an instance.
