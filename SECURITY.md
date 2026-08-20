# Security Policy

## Reporting A Vulnerability

After the public repository is published, please report security issues through
the repository's private vulnerability reporting feature if available, or by
opening a minimal issue that does not include exploit details.

Please include:

- Affected TabWake version.
- Browser and operating system.
- Steps to reproduce.
- Expected and actual behavior.
- Any relevant permission, URL, or import/export context.

## Security Model

TabWake is designed to keep configuration local. It declares broad HTTP(S)
patterns only as optional host permissions and requests a site origin only when
the user confirms Auto-update for that site. Auto-update reads the prefix page
above the marked update part and same-site sitemap fallback to find newer
matching URLs. The extension does not run remote code or send configuration to
external services.

## Supported Versions

Security fixes are expected to target the latest released version.
