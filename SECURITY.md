# Security Policy

## Supported Versions

Stormths is a single-page browser application. Only the latest version on the
`main` branch receives fixes.

| Version        | Supported |
| -------------- | --------- |
| `main` (latest) | ✅        |
| Older commits  | ❌        |

## Scope

Stormths runs entirely in your browser. It has no server, no accounts, and does
not collect, store or send any personal data.

Relevant security issues include, for example:
- Code that could run untrusted scripts in the user's browser (XSS)
- Loading of external resources that could be tampered with
- Anything that could crash or freeze the user's browser or GPU on purpose

Performance problems or simulation bugs are not security issues — please open a
normal issue for those.

## Reporting a Vulnerability

Please **do not** open a public issue for security problems.

Instead, report it privately through GitHub:
1. Go to the **Security** tab of this repository.
2. Click **Report a vulnerability**.
3. Describe the problem and, if possible, how to reproduce it.

You can expect a first response within 7 days. If the report is confirmed, a fix
will be published as soon as possible and you will be credited in the release
notes (unless you prefer to stay anonymous).
