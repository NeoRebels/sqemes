# CLA signatures

This branch stores the record of who has signed the
[Contributor License Agreement](https://github.com/NeoRebels/sqemes/blob/main/CLA.md),
in `signatures/version1/cla.json`. It is written automatically by the CLA workflow when a
contributor replies to the bot on their first pull request.

**It is deliberately an orphan branch, and it must stay off `main`.**

This repository is generated: every release wipes `main` and rewrites it from upstream. A signature
file on `main` would therefore be erased by the next release — silently, taking the record of who
granted which rights with it. That is the one failure in this mechanism that would not announce
itself, so the signatures live here, where the export never reaches.

Nothing else belongs on this branch.
