# Platform code-size constraint

## Conclusion

The operational upload limit is **204,800 UTF-8 bytes (200 KiB)**. The warning
threshold is **190,000 UTF-8 bytes**. The measured object is the exact minified
JavaScript string sent in the `code` field; JavaScript `string.length`, source
file size, and JSON request-body size are not substitutes.

The current official Agent Guide snapshot documents the publish and simulation
endpoints but does not state an exact code-size number. The pinned
`agentank-framework` commit `b676a7f3b58a3d462635171c73632c00feeafab6`
documents “about 200 KiB (UTF-8)” and implements
`CODE_SIZE_LIMIT_BYTES = 200 * 1024` with a 190,000-byte warning. Local V1
release history independently agrees with that boundary: the 206,690-byte
source was over the limit by 1,890 bytes, while the published 105,571-byte
Terser artifact had 99,229 bytes of headroom.

This is therefore an operational fail-closed constraint backed by the pinned
framework and real V1 release evidence. It is not mislabelled as a number
published in the official Agent Guide.

## Current V2 result

| Artifact | UTF-8 bytes | Limit | Headroom | Result |
| --- | ---: | ---: | ---: | --- |
| normalized production source | 412,201 | 204,800 | -207,401 | not uploadable |
| current production minified | 397,799 | 204,800 | -192,999 | **blocked** |
| experimental local-variable mangle | 289,849 | 204,800 | -85,049 | still blocked |

The V2 candidate is therefore not eligible for official simulation or publish.
Turning on ordinary Terser variable mangling alone cannot close the gap; later
size work must remove or specialize production code while preserving the
source/minified semantic fingerprint and all structural-repair gates.

## Enforced contract

- [platform-code-size-policy.json](../../config/agentank/platform-code-size-policy.json)
  is the single policy record and pins the evidence URLs and framework commit.
- BuildManifest measures `production-minified.js` with
  `Buffer.byteLength(code, "utf8")`, records bytes/headroom, and emits
  `PLATFORM_SCRIPT_BYTE_LIMIT_EXCEEDED` when necessary.
- Candidate freeze cannot accept an oversized build.
- IMP8 readiness exposes the byte failure as an internal blocker.
- Official simulate and publish clients reject oversized code before making a
  network request.
- `PLATFORM_SCRIPT_BYTE_LIMIT_UNKNOWN` remains as an evidence-quality blocker
  because the official guide omits the number; it is separate from the active
  `PLATFORM_SCRIPT_BYTE_LIMIT_EXCEEDED` failure.
- Publish branch values are locally restricted to `main`, `raid`, or
  `multiplayer`. Server-side fallback is never trusted.
- Boundary UT covers 204,800/204,801 ASCII bytes, multibyte UTF-8, both network
  operations, and invalid branch rejection.

## Evidence caveat and incident record

During boundary investigation, an invalid publish branch was discovered to be
silently treated by the platform as `main`. A validation probe briefly created
V2 version 2. The verified baseline was immediately republished as version 3;
the live main code hash was restored to
`7daf591e97474e7b7f1814fa4d7156356f49f4c9615aae7f144b5c7bb62448b2`.
No V2 strategy Candidate was published. This is why branch validation is now a
mandatory local hard gate.
