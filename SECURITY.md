# Security Policy

At SipHeron Engineering, we take the security of `vdr-pipeline` and enterprise cryptographic infrastructure extremely seriously. We appreciate your efforts to responsibly disclose your findings, and we will make every effort to acknowledge your contributions.

## Supported Versions

Currently, the following versions are receiving security updates:

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

*Older versions are not supported. Please upgrade to the latest minor version.*

## Reporting a Vulnerability

**DO NOT create a public GitHub issue for security vulnerabilities.**

If you believe you have found a security vulnerability in `vdr-pipeline`, please report it to us confidentially by emailing:

**security@sipheron.com**

Please include the following details in your report:
*   A description of the vulnerability.
*   The versions of `@sipheron/vdr-pipeline` and `@sipheron/vdr-core` that are affected.
*   Detailed steps to reliably reproduce the issue (code snippets or PoC scripts are highly appreciated).
*   Any potential impact or exploit scenarios (e.g., cryptographic bypass, private key exposure, Merkle tree poisoning).

### What Happens Next?
1.  **Response**: You should receive an initial acknowledgment of your report within 48 business hours.
2.  **Triage**: Our engineering and cryptography teams will triage the report and determine the impact. We may reach out for further clarification.
3.  **Remediation**: If confirmed, we will work on a patch and coordinate a disclosure timeline with you.
4.  **Credit**: With your permission, we will credit you in the release notes when the fix is deployed.

## Scope
This policy applies to the TypeScript SDK code and the provided ZK Circom templates within this repository. 

Vulnerabilities regarding the SipHeron Managed API Server or the Solana `vdr_contract` should also be reported to the security email above, but they reside in separate repositories.
