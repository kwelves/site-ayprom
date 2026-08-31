# Geist font assets

## Vendored binary provenance

These files are the exact variable Geist Sans webfont subsets emitted by
Next.js 16.2.11 for the project's former `next/font/google` call:

- generated module: `[next]/internal/font/google/geist_a71539c9.module.css`;
- Google Fonts CSS request:
  `https://fonts.googleapis.com/css2?family=Geist:wght@100..900&display=swap`;
- request User-Agent: the Chrome 104 User-Agent hard-coded by the Next.js
  16.2.11 Google font loader;
- embedded font metadata: `Geist Regular`, `Version 1.800`, variable `wght`
  axis from 100 through 900.

On 2026-08-31, the five official Google Fonts `v5` source URLs below were
fetched in memory with that User-Agent. Every response SHA-256 matched the
already-present local Next.js build artifact and the corresponding vendored
file byte-for-byte:

| Local file | Google Fonts source URL | SHA-256 |
| --- | --- | --- |
| `geist-cyrillic-ext-variable.woff2` | `https://fonts.gstatic.com/s/geist/v5/gyByhwUxId8gMEwRGFWNOITddY4.woff2` | `B7A545BBB08256BD809F11CFE66D88DA3E22D169EA4407737B1EF0EC1ED3D791` |
| `geist-cyrillic-variable.woff2` | `https://fonts.gstatic.com/s/geist/v5/gyByhwUxId8gMEwYGFWNOITddY4.woff2` | `6129FC8571C3E0CB0A4C41F5160C974A843B055009DC4AD8858BD808E18A2D86` |
| `geist-vietnamese-variable.woff2` | `https://fonts.gstatic.com/s/geist/v5/gyByhwUxId8gMEwTGFWNOITddY4.woff2` | `F689F638F29FFF460A2D5749EDB5D5C38D7BEF0389F32032D871F23FC6EBB008` |
| `geist-latin-ext-variable.woff2` | `https://fonts.gstatic.com/s/geist/v5/gyByhwUxId8gMEwSGFWNOITddY4.woff2` | `58A6B173D5CA1DEC92166EA3C6CB1A84A4144556D10928AC14E8E6B40E4787BD` |
| `geist-latin-variable.woff2` | `https://fonts.gstatic.com/s/geist/v5/gyByhwUxId8gMEwcGFWNOITd.woff2` | `9B6F5FF45B278C744B5F379A2C4ECBAF858A842B8EAF82AC8D21B699CA16C608` |

The subset names and CSS `unicode-range` declarations in `globals.css` match
the generated Next.js font CSS.

## Immutable upstream reference

The official Geist source and license repository is `vercel/geist-font`.
The full commit SHA `a73329da8fc62afc917f796555202e4997f79b7c` is the
immutable upstream coordinate current when these assets were documented. Tag
`v1.7.2` is included only as a human-readable release label and is not treated
as an immutable reference:

https://github.com/vercel/geist-font/tree/a73329da8fc62afc917f796555202e4997f79b7c

Commit `a73329da8fc62afc917f796555202e4997f79b7c` is the immutable
project/license reference. It is not claimed as the direct byte source for
these Google Fonts subset builds; the exact binary coordinates are the
`fonts.gstatic.com/s/geist/v5/` URLs and checksums above.

License: SIL Open Font License 1.1. See `LICENSE.txt` and `COPYRIGHT.txt`.
