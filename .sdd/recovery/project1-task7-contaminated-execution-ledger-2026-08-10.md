LINE 114 PATH /response/text

## Removed blogs

A total of **15 posts** were deleted from the content directory.

### Removed earlier at your request

1. **The Silent Threat: Understanding Pre-Account Takeover Attacks**
   - `pre-account-takeover.md`

2. **When Data Whispers Secrets: Understanding Sensitive Information Disclosure in Modern Systems**
   - `sensitive-information-disclosure.md`

### Removed during the editorial curation

3. **FlashCrawler v2.0**
   - `flashcrawler-v2.md`

4. **Google Dorks: The Power of Advanced Search Operators**
   - `google-dorks-guide.md`

5. **How We Discovered a Stored HTML Injection in a Chatbot System**
   - `html-injection-chatbot.md`

6. **Mastering Nmap: The Ultimate Guide to Port Scanning**
   - `mastering-nmap.md`

7. **NoSQL Injection: Exploitation Techniques and Attack Scenarios**
   - `nosql-injection.md`

8. **Rate Limiting: When Your Server Says Chill, Bro**
   - `rate-limiting-guide.md`

9. **Understanding Reverse DNS**
   - `reverse-dns-guide.md`

10. **Shellshock: The Bash Bug That Shook the Internet**
    - `shellshock-bash-bug.md`

11. **SQLMap: The Ultimate Guide to Automated SQL Injection Testing**
    - `sqlmap-ultimate-guide.md`

12. **SSRF: When Your Server Becomes a Nosy Hacker — Part 1**
    - `ssrf-server-side-request-forgery.md`

13. **Subdomain Takeover: When Your Own Domain Becomes Your Enemy**
    - `subdomain-takeover.md`

14. **Sweet Security Disaster**
    - `sweet-security-disaster.md`

15. **From Shodan to SQLi: Hacking an Exposed Company Dashboard**
    - `from-shodan-to-sqli.md`

All of these remain recoverable from Git history.

---

## Best candidates to rewrite and restore

These removed posts have enough potential for a substantially better version.

### 1. Google Dorks Guide

**Restoration potential: High—but not as another operator list.**

The strongest version would be a methodology article:

> **How I Turn Recon Queries Into Responsible Vulnerability Reports**

It could cover:

- How you define an authorized search scope
- How you remove duplicates and false positives
- How you move from an indexed page to a reproducible finding
- How you preserve evidence without collecting sensitive data
- How you report and verify remediation
- Lessons from your CERT-In experience
- Current operators only, verified against Google documentation

It should avoid credential-search examples, exposed-camera queries, and unsupported breach stories. Some of this material may be better incorporated into the draft **From Dorks to Defense** rather than restored as a separate article.

### 2. From Shodan to SQLi

**Restoration potential: High if authorization and disclosure can be documented.**

A strong rewrite would be:

> **From Exposed Service to Validated SQL Injection: A Responsible Assessment Workflow**

It needs:

- Explicit authorization or disclosure context
- What Shodan revealed—and what it did not prove
- Manual confirmation steps
- Minimal-impact validation
- Evidence captured
- Vendor communication
- Remediation and retesting outcome
- Removal of identifiers and sensitive data
- No exaggerated impact claims

If the authorization or disclosure status cannot be clearly stated, it should remain retired.

### 3. Rate Limiting

**Restoration potential: Medium-high as an engineering article.**

Instead of a generic bypass list:

> **Testing Rate Limits Correctly: Identity, Windows, Concurrency, and Distributed State**

A modern rewrite could include:

- Fixed-window, sliding-window, token-bucket, and leaky-bucket models
- User, session, API key, device, and IP identities
- Trusted proxy and forwarded-header boundaries
- Race conditions and concurrent requests
- Distributed counters and atomicity
- `Retry-After` and rate-limit headers
- Fail-open versus fail-closed decisions
- A small reproducible local lab
- Defensive test cases

It should remove the incorrect implication that ordinary TCP clients can spoof source IPs and receive responses.

### 4. SSRF

**Restoration potential: Medium-high if rewritten defensively.**

A strong modern version could be:

> **Designing SSRF-Resistant Fetchers: URL Parsing, DNS Resolution, Redirects, and Cloud Metadata**

It should focus on:

- URL parser ambiguity
- Scheme restrictions
- DNS resolution and rebinding
- Redirect revalidation
- IPv4/IPv6 normalization
- Private, loopback, link-local, and special-use networks
- Cloud metadata protections, including IMDSv2
- Egress controls
- Proxy architecture
- A tested allowlist/denylist implementation
- Unit-test cases for bypass attempts

The old payload-heavy, malformed “Part 1” version should not return unchanged.

### 5. Subdomain Takeover

**Restoration potential: Medium, but only with a confirmed case or a false-positive angle.**

The old post did not establish a takeover. The most honest rewrite would be:

> **I Thought I Found a Subdomain Takeover. Here’s Why It Was a False Positive.**

That could become useful by explaining:

- CNAME and service-claim relationships
- Provider fingerprints
- Domain verification records
- Why arbitrary TXT records do not inherently prevent takeover
- How to distinguish dangling DNS from a claimable resource
- Modern provider protections
- Safe validation boundaries
- A decision tree for triage

This would fit your newer style of documenting when your initial conclusion was wrong.

### 6. NoSQL Injection

**Restoration potential: Medium.**

It would need a real lab and narrower scope:

> **MongoDB Operator Injection in Practice: Reproduction, Root Cause, and Typed Defenses**

Necessary improvements:

- Clearly scope it to MongoDB/operator injection
- Use valid, formatted request examples
- Explain query construction precisely
- Show typed schema validation
- Reject unexpected operators
- Discuss authorization separately from injection
- Avoid presenting every NoSQL database as equivalent
- Cite PortSwigger or other training sources where applicable
- Include a reproducible local demo and tests

Without original experimentation, this remains too generic for the curated archive.

### 7. Shellshock

**Restoration potential: Medium-low, unless you perform new research.**

A worthwhile version would require a current measurement:

> **Is Shellshock Still Exposed in 2026? Measuring Legacy CGI Risk Safely**

That would need:

- A lawful dataset or owned test environment
- Clear fingerprinting limitations
- No assumption that an Apache version proves Shellshock
- Current exposure counts
- Safe detection rather than command-execution payloads
- Modern containment and remediation guidance
- Historical context with primary sources

A generic Shellshock retrospective is not strong enough to restore.

### 8. Reverse DNS

**Restoration potential: Medium-low as part of a larger telemetry article.**

It could become:

> **What PTR, RDAP, ASN, and Forward DNS Actually Tell You About an Attacker IP**

This would fit your honeypot work if it compares:

- PTR records
- Forward-confirmed reverse DNS
- RDAP/RIR ownership
- ASN and hosting-provider attribution
- Geolocation limitations
- Why a hostname does not establish ownership or identity
- How ShardLure enriches IP information

This is better as a section in a threat-intelligence article than a standalone primer.

---

## Posts that should probably remain retired

### FlashCrawler v2

It primarily promoted another person’s tool and had unclear authorship value. Restore it only if you personally contributed significant engineering work and can explain that contribution precisely.

### Stored HTML Injection in a Chatbot

The vendor already knew about the issue, and the existing evidence did not establish meaningful impact. A new post would need a distinct discovery, clear rendering context, sanitization analysis, CSP analysis, and responsible disclosure outcome.

### Mastering Nmap

The topic is saturated, and authoritative Nmap documentation is better than another command roundup. It would only be worth restoring around original measurement, automation, detection research, or a unique lab.

### SQLMap Guide

A generic SQLMap walkthrough adds limited portfolio value and can encourage overly aggressive testing defaults. SQLMap could instead appear briefly inside an authorized SQL-injection case study.

### Sweet Security Disaster

The existing post lacked a clear disclosure and remediation outcome. Restore it only if you can establish authorization, vendor notification, impact boundaries, and resolution.

### Pre-Account Takeover

The removed version was generic. It should only return if tied to an original finding, a reproducible application flaw, or a rigorous lab demonstrating a specific pre-hijacking pattern.

### Sensitive Information Disclosure

The removed version was also generic. This topic would be stronger as an evidence-driven case study covering one concrete leak, its threat model, remediation, and retest.

---

## Already preserved for rewriting

These four were **not deleted**. They are stored as drafts and are the highest-priority restoration queue:

1. **From Dorks to Defense**
2. **Business Logic: Broken**
3. **Why IDORs Are Everywhere**
4. **XSS Meets IDOR**

They already contain firsthand material and should be rewritten before reviving generic tutorials.

## Recommended restoration order

1. **From Dorks to Defense**
2. **Why IDORs Are Everywhere**
3. **Business Logic: Broken**
4. **XSS Meets IDOR**
5. **From Shodan to SQLi**, if authorization/disclosure can be documented
6. **Subdomain Takeover**, reframed as a false-positive investigation
7. **SSRF**, rebuilt as a defensive engineering guide
8. **Rate Limiting**, rebuilt around implementation and test design

That path would grow the blog without diluting its new focus on original findings, measured telemetry, and tools you actually built.
---END---
LINE 115 PATH /request/messages/62/content

## Removed blogs

A total of **15 posts** were deleted from the content directory.

### Removed earlier at your request

1. **The Silent Threat: Understanding Pre-Account Takeover Attacks**
   - `pre-account-takeover.md`

2. **When Data Whispers Secrets: Understanding Sensitive Information Disclosure in Modern Systems**
   - `sensitive-information-disclosure.md`

### Removed during the editorial curation

3. **FlashCrawler v2.0**
   - `flashcrawler-v2.md`

4. **Google Dorks: The Power of Advanced Search Operators**
   - `google-dorks-guide.md`

5. **How We Discovered a Stored HTML Injection in a Chatbot System**
   - `html-injection-chatbot.md`

6. **Mastering Nmap: The Ultimate Guide to Port Scanning**
   - `mastering-nmap.md`

7. **NoSQL Injection: Exploitation Techniques and Attack Scenarios**
   - `nosql-injection.md`

8. **Rate Limiting: When Your Server Says Chill, Bro**
   - `rate-limiting-guide.md`

9. **Understanding Reverse DNS**
   - `reverse-dns-guide.md`

10. **Shellshock: The Bash Bug That Shook the Internet**
    - `shellshock-bash-bug.md`

11. **SQLMap: The Ultimate Guide to Automated SQL Injection Testing**
    - `sqlmap-ultimate-guide.md`

12. **SSRF: When Your Server Becomes a Nosy Hacker — Part 1**
    - `ssrf-server-side-request-forgery.md`

13. **Subdomain Takeover: When Your Own Domain Becomes Your Enemy**
    - `subdomain-takeover.md`

14. **Sweet Security Disaster**
    - `sweet-security-disaster.md`

15. **From Shodan to SQLi: Hacking an Exposed Company Dashboard**
    - `from-shodan-to-sqli.md`

All of these remain recoverable from Git history.

---

## Best candidates to rewrite and restore

These removed posts have enough potential for a substantially better version.

### 1. Google Dorks Guide

**Restoration potential: High—but not as another operator list.**

The strongest version would be a methodology article:

> **How I Turn Recon Queries Into Responsible Vulnerability Reports**

It could cover:

- How you define an authorized search scope
- How you remove duplicates and false positives
- How you move from an indexed page to a reproducible finding
- How you preserve evidence without collecting sensitive data
- How you report and verify remediation
- Lessons from your CERT-In experience
- Current operators only, verified against Google documentation

It should avoid credential-search examples, exposed-camera queries, and unsupported breach stories. Some of this material may be better incorporated into the draft **From Dorks to Defense** rather than restored as a separate article.

### 2. From Shodan to SQLi

**Restoration potential: High if authorization and disclosure can be documented.**

A strong rewrite would be:

> **From Exposed Service to Validated SQL Injection: A Responsible Assessment Workflow**

It needs:

- Explicit authorization or disclosure context
- What Shodan revealed—and what it did not prove
- Manual confirmation steps
- Minimal-impact validation
- Evidence captured
- Vendor communication
- Remediation and retesting outcome
- Removal of identifiers and sensitive data
- No exaggerated impact claims

If the authorization or disclosure status cannot be clearly stated, it should remain retired.

### 3. Rate Limiting

**Restoration potential: Medium-high as an engineering article.**

Instead of a generic bypass list:

> **Testing Rate Limits Correctly: Identity, Windows, Concurrency, and Distributed State**

A modern rewrite could include:

- Fixed-window, sliding-window, token-bucket, and leaky-bucket models
- User, session, API key, device, and IP identities
- Trusted proxy and forwarded-header boundaries
- Race conditions and concurrent requests
- Distributed counters and atomicity
- `Retry-After` and rate-limit headers
- Fail-open versus fail-closed decisions
- A small reproducible local lab
- Defensive test cases

It should remove the incorrect implication that ordinary TCP clients can spoof source IPs and receive responses.

### 4. SSRF

**Restoration potential: Medium-high if rewritten defensively.**

A strong modern version could be:

> **Designing SSRF-Resistant Fetchers: URL Parsing, DNS Resolution, Redirects, and Cloud Metadata**

It should focus on:

- URL parser ambiguity
- Scheme restrictions
- DNS resolution and rebinding
- Redirect revalidation
- IPv4/IPv6 normalization
- Private, loopback, link-local, and special-use networks
- Cloud metadata protections, including IMDSv2
- Egress controls
- Proxy architecture
- A tested allowlist/denylist implementation
- Unit-test cases for bypass attempts

The old payload-heavy, malformed “Part 1” version should not return unchanged.

### 5. Subdomain Takeover

**Restoration potential: Medium, but only with a confirmed case or a false-positive angle.**

The old post did not establish a takeover. The most honest rewrite would be:

> **I Thought I Found a Subdomain Takeover. Here’s Why It Was a False Positive.**

That could become useful by explaining:

- CNAME and service-claim relationships
- Provider fingerprints
- Domain verification records
- Why arbitrary TXT records do not inherently prevent takeover
- How to distinguish dangling DNS from a claimable resource
- Modern provider protections
- Safe validation boundaries
- A decision tree for triage

This would fit your newer style of documenting when your initial conclusion was wrong.

### 6. NoSQL Injection

**Restoration potential: Medium.**

It would need a real lab and narrower scope:

> **MongoDB Operator Injection in Practice: Reproduction, Root Cause, and Typed Defenses**

Necessary improvements:

- Clearly scope it to MongoDB/operator injection
- Use valid, formatted request examples
- Explain query construction precisely
- Show typed schema validation
- Reject unexpected operators
- Discuss authorization separately from injection
- Avoid presenting every NoSQL database as equivalent
- Cite PortSwigger or other training sources where applicable
- Include a reproducible local demo and tests

Without original experimentation, this remains too generic for the curated archive.

### 7. Shellshock

**Restoration potential: Medium-low, unless you perform new research.**

A worthwhile version would require a current measurement:

> **Is Shellshock Still Exposed in 2026? Measuring Legacy CGI Risk Safely**

That would need:

- A lawful dataset or owned test environment
- Clear fingerprinting limitations
- No assumption that an Apache version proves Shellshock
- Current exposure counts
- Safe detection rather than command-execution payloads
- Modern containment and remediation guidance
- Historical context with primary sources

A generic Shellshock retrospective is not strong enough to restore.

### 8. Reverse DNS

**Restoration potential: Medium-low as part of a larger telemetry article.**

It could become:

> **What PTR, RDAP, ASN, and Forward DNS Actually Tell You About an Attacker IP**

This would fit your honeypot work if it compares:

- PTR records
- Forward-confirmed reverse DNS
- RDAP/RIR ownership
- ASN and hosting-provider attribution
- Geolocation limitations
- Why a hostname does not establish ownership or identity
- How ShardLure enriches IP information

This is better as a section in a threat-intelligence article than a standalone primer.

---

## Posts that should probably remain retired

### FlashCrawler v2

It primarily promoted another person’s tool and had unclear authorship value. Restore it only if you personally contributed significant engineering work and can explain that contribution precisely.

### Stored HTML Injection in a Chatbot

The vendor already knew about the issue, and the existing evidence did not establish meaningful impact. A new post would need a distinct discovery, clear rendering context, sanitization analysis, CSP analysis, and responsible disclosure outcome.

### Mastering Nmap

The topic is saturated, and authoritative Nmap documentation is better than another command roundup. It would only be worth restoring around original measurement, automation, detection research, or a unique lab.

### SQLMap Guide

A generic SQLMap walkthrough adds limited portfolio value and can encourage overly aggressive testing defaults. SQLMap could instead appear briefly inside an authorized SQL-injection case study.

### Sweet Security Disaster

The existing post lacked a clear disclosure and remediation outcome. Restore it only if you can establish authorization, vendor notification, impact boundaries, and resolution.

### Pre-Account Takeover

The removed version was generic. It should only return if tied to an original finding, a reproducible application flaw, or a rigorous lab demonstrating a specific pre-hijacking pattern.

### Sensitive Information Disclosure

The removed version was also generic. This topic would be stronger as an evidence-driven case study covering one concrete leak, its threat model, remediation, and retest.

---

## Already preserved for rewriting

These four were **not deleted**. They are stored as drafts and are the highest-priority restoration queue:

1. **From Dorks to Defense**
2. **Business Logic: Broken**
3. **Why IDORs Are Everywhere**
4. **XSS Meets IDOR**

They already contain firsthand material and should be rewritten before reviving generic tutorials.

## Recommended restoration order

1. **From Dorks to Defense**
2. **Why IDORs Are Everywhere**
3. **Business Logic: Broken**
4. **XSS Meets IDOR**
5. **From Shodan to SQLi**, if authorization/disclosure can be documented
6. **Subdomain Takeover**, reframed as a false-positive investigation
7. **SSRF**, rebuilt as a defensive engineering guide
8. **Rate Limiting**, rebuilt around implementation and test design

That path would grow the blog without diluting its new focus on original findings, measured telemetry, and tools you actually built.
---END---
LINE 116 PATH /request/messages/60/content

## Removed blogs

A total of **15 posts** were deleted from the content directory.

### Removed earlier at your request

1. **The Silent Threat: Understanding Pre-Account Takeover Attacks**
   - `pre-account-takeover.md`

2. **When Data Whispers Secrets: Understanding Sensitive Information Disclosure in Modern Systems**
   - `sensitive-information-disclosure.md`

### Removed during the editorial curation

3. **FlashCrawler v2.0**
   - `flashcrawler-v2.md`

4. **Google Dorks: The Power of Advanced Search Operators**
   - `google-dorks-guide.md`

5. **How We Discovered a Stored HTML Injection in a Chatbot System**
   - `html-injection-chatbot.md`

6. **Mastering Nmap: The Ultimate Guide to Port Scanning**
   - `mastering-nmap.md`

7. **NoSQL Injection: Exploitation Techniques and Attack Scenarios**
   - `nosql-injection.md`

8. **Rate Limiting: When Your Server Says Chill, Bro**
   - `rate-limiting-guide.md`

9. **Understanding Reverse DNS**
   - `reverse-dns-guide.md`

10. **Shellshock: The Bash Bug That Shook the Internet**
    - `shellshock-bash-bug.md`

11. **SQLMap: The Ultimate Guide to Automated SQL Injection Testing**
    - `sqlmap-ultimate-guide.md`

12. **SSRF: When Your Server Becomes a Nosy Hacker — Part 1**
    - `ssrf-server-side-request-forgery.md`

13. **Subdomain Takeover: When Your Own Domain Becomes Your Enemy**
    - `subdomain-takeover.md`

14. **Sweet Security Disaster**
    - `sweet-security-disaster.md`

15. **From Shodan to SQLi: Hacking an Exposed Company Dashboard**
    - `from-shodan-to-sqli.md`

All of these remain recoverable from Git history.

---

## Best candidates to rewrite and restore

These removed posts have enough potential for a substantially better version.

### 1. Google Dorks Guide

**Restoration potential: High—but not as another operator list.**

The strongest version would be a methodology article:

> **How I Turn Recon Queries Into Responsible Vulnerability Reports**

It could cover:

- How you define an authorized search scope
- How you remove duplicates and false positives
- How you move from an indexed page to a reproducible finding
- How you preserve evidence without collecting sensitive data
- How you report and verify remediation
- Lessons from your CERT-In experience
- Current operators only, verified against Google documentation

It should avoid credential-search examples, exposed-camera queries, and unsupported breach stories. Some of this material may be better incorporated into the draft **From Dorks to Defense** rather than restored as a separate article.

### 2. From Shodan to SQLi

**Restoration potential: High if authorization and disclosure can be documented.**

A strong rewrite would be:

> **From Exposed Service to Validated SQL Injection: A Responsible Assessment Workflow**

It needs:

- Explicit authorization or disclosure context
- What Shodan revealed—and what it did not prove
- Manual confirmation steps
- Minimal-impact validation
- Evidence captured
- Vendor communication
- Remediation and retesting outcome
- Removal of identifiers and sensitive data
- No exaggerated impact claims

If the authorization or disclosure status cannot be clearly stated, it should remain retired.

### 3. Rate Limiting

**Restoration potential: Medium-high as an engineering article.**

Instead of a generic bypass list:

> **Testing Rate Limits Correctly: Identity, Windows, Concurrency, and Distributed State**

A modern rewrite could include:

- Fixed-window, sliding-window, token-bucket, and leaky-bucket models
- User, session, API key, device, and IP identities
- Trusted proxy and forwarded-header boundaries
- Race conditions and concurrent requests
- Distributed counters and atomicity
- `Retry-After` and rate-limit headers
- Fail-open versus fail-closed decisions
- A small reproducible local lab
- Defensive test cases

It should remove the incorrect implication that ordinary TCP clients can spoof source IPs and receive responses.

### 4. SSRF

**Restoration potential: Medium-high if rewritten defensively.**

A strong modern version could be:

> **Designing SSRF-Resistant Fetchers: URL Parsing, DNS Resolution, Redirects, and Cloud Metadata**

It should focus on:

- URL parser ambiguity
- Scheme restrictions
- DNS resolution and rebinding
- Redirect revalidation
- IPv4/IPv6 normalization
- Private, loopback, link-local, and special-use networks
- Cloud metadata protections, including IMDSv2
- Egress controls
- Proxy architecture
- A tested allowlist/denylist implementation
- Unit-test cases for bypass attempts

The old payload-heavy, malformed “Part 1” version should not return unchanged.

### 5. Subdomain Takeover

**Restoration potential: Medium, but only with a confirmed case or a false-positive angle.**

The old post did not establish a takeover. The most honest rewrite would be:

> **I Thought I Found a Subdomain Takeover. Here’s Why It Was a False Positive.**

That could become useful by explaining:

- CNAME and service-claim relationships
- Provider fingerprints
- Domain verification records
- Why arbitrary TXT records do not inherently prevent takeover
- How to distinguish dangling DNS from a claimable resource
- Modern provider protections
- Safe validation boundaries
- A decision tree for triage

This would fit your newer style of documenting when your initial conclusion was wrong.

### 6. NoSQL Injection

**Restoration potential: Medium.**

It would need a real lab and narrower scope:

> **MongoDB Operator Injection in Practice: Reproduction, Root Cause, and Typed Defenses**

Necessary improvements:

- Clearly scope it to MongoDB/operator injection
- Use valid, formatted request examples
- Explain query construction precisely
- Show typed schema validation
- Reject unexpected operators
- Discuss authorization separately from injection
- Avoid presenting every NoSQL database as equivalent
- Cite PortSwigger or other training sources where applicable
- Include a reproducible local demo and tests

Without original experimentation, this remains too generic for the curated archive.

### 7. Shellshock

**Restoration potential: Medium-low, unless you perform new research.**

A worthwhile version would require a current measurement:

> **Is Shellshock Still Exposed in 2026? Measuring Legacy CGI Risk Safely**

That would need:

- A lawful dataset or owned test environment
- Clear fingerprinting limitations
- No assumption that an Apache version proves Shellshock
- Current exposure counts
- Safe detection rather than command-execution payloads
- Modern containment and remediation guidance
- Historical context with primary sources

A generic Shellshock retrospective is not strong enough to restore.

### 8. Reverse DNS

**Restoration potential: Medium-low as part of a larger telemetry article.**

It could become:

> **What PTR, RDAP, ASN, and Forward DNS Actually Tell You About an Attacker IP**

This would fit your honeypot work if it compares:

- PTR records
- Forward-confirmed reverse DNS
- RDAP/RIR ownership
- ASN and hosting-provider attribution
- Geolocation limitations
- Why a hostname does not establish ownership or identity
- How ShardLure enriches IP information

This is better as a section in a threat-intelligence article than a standalone primer.

---

## Posts that should probably remain retired

### FlashCrawler v2

It primarily promoted another person’s tool and had unclear authorship value. Restore it only if you personally contributed significant engineering work and can explain that contribution precisely.

### Stored HTML Injection in a Chatbot

The vendor already knew about the issue, and the existing evidence did not establish meaningful impact. A new post would need a distinct discovery, clear rendering context, sanitization analysis, CSP analysis, and responsible disclosure outcome.

### Mastering Nmap

The topic is saturated, and authoritative Nmap documentation is better than another command roundup. It would only be worth restoring around original measurement, automation, detection research, or a unique lab.

### SQLMap Guide

A generic SQLMap walkthrough adds limited portfolio value and can encourage overly aggressive testing defaults. SQLMap could instead appear briefly inside an authorized SQL-injection case study.

### Sweet Security Disaster

The existing post lacked a clear disclosure and remediation outcome. Restore it only if you can establish authorization, vendor notification, impact boundaries, and resolution.

### Pre-Account Takeover

The removed version was generic. It should only return if tied to an original finding, a reproducible application flaw, or a rigorous lab demonstrating a specific pre-hijacking pattern.

### Sensitive Information Disclosure

The removed version was also generic. This topic would be stronger as an evidence-driven case study covering one concrete leak, its threat model, remediation, and retest.

---

## Already preserved for rewriting

These four were **not deleted**. They are stored as drafts and are the highest-priority restoration queue:

1. **From Dorks to Defense**
2. **Business Logic: Broken**
3. **Why IDORs Are Everywhere**
4. **XSS Meets IDOR**

They already contain firsthand material and should be rewritten before reviving generic tutorials.

## Recommended restoration order

1. **From Dorks to Defense**
2. **Why IDORs Are Everywhere**
3. **Business Logic: Broken**
4. **XSS Meets IDOR**
5. **From Shodan to SQLi**, if authorization/disclosure can be documented
6. **Subdomain Takeover**, reframed as a false-positive investigation
7. **SSRF**, rebuilt as a defensive engineering guide
8. **Rate Limiting**, rebuilt around implementation and test design

That path would grow the blog without diluting its new focus on original findings, measured telemetry, and tools you actually built.
---END---
LINE 117 PATH /request/messages/58/content

## Removed blogs

A total of **15 posts** were deleted from the content directory.

### Removed earlier at your request

1. **The Silent Threat: Understanding Pre-Account Takeover Attacks**
   - `pre-account-takeover.md`

2. **When Data Whispers Secrets: Understanding Sensitive Information Disclosure in Modern Systems**
   - `sensitive-information-disclosure.md`

### Removed during the editorial curation

3. **FlashCrawler v2.0**
   - `flashcrawler-v2.md`

4. **Google Dorks: The Power of Advanced Search Operators**
   - `google-dorks-guide.md`

5. **How We Discovered a Stored HTML Injection in a Chatbot System**
   - `html-injection-chatbot.md`

6. **Mastering Nmap: The Ultimate Guide to Port Scanning**
   - `mastering-nmap.md`

7. **NoSQL Injection: Exploitation Techniques and Attack Scenarios**
   - `nosql-injection.md`

8. **Rate Limiting: When Your Server Says Chill, Bro**
   - `rate-limiting-guide.md`

9. **Understanding Reverse DNS**
   - `reverse-dns-guide.md`

10. **Shellshock: The Bash Bug That Shook the Internet**
    - `shellshock-bash-bug.md`

11. **SQLMap: The Ultimate Guide to Automated SQL Injection Testing**
    - `sqlmap-ultimate-guide.md`

12. **SSRF: When Your Server Becomes a Nosy Hacker — Part 1**
    - `ssrf-server-side-request-forgery.md`

13. **Subdomain Takeover: When Your Own Domain Becomes Your Enemy**
    - `subdomain-takeover.md`

14. **Sweet Security Disaster**
    - `sweet-security-disaster.md`

15. **From Shodan to SQLi: Hacking an Exposed Company Dashboard**
    - `from-shodan-to-sqli.md`

All of these remain recoverable from Git history.

---

## Best candidates to rewrite and restore

These removed posts have enough potential for a substantially better version.

### 1. Google Dorks Guide

**Restoration potential: High—but not as another operator list.**

The strongest version would be a methodology article:

> **How I Turn Recon Queries Into Responsible Vulnerability Reports**

It could cover:

- How you define an authorized search scope
- How you remove duplicates and false positives
- How you move from an indexed page to a reproducible finding
- How you preserve evidence without collecting sensitive data
- How you report and verify remediation
- Lessons from your CERT-In experience
- Current operators only, verified against Google documentation

It should avoid credential-search examples, exposed-camera queries, and unsupported breach stories. Some of this material may be better incorporated into the draft **From Dorks to Defense** rather than restored as a separate article.

### 2. From Shodan to SQLi

**Restoration potential: High if authorization and disclosure can be documented.**

A strong rewrite would be:

> **From Exposed Service to Validated SQL Injection: A Responsible Assessment Workflow**

It needs:

- Explicit authorization or disclosure context
- What Shodan revealed—and what it did not prove
- Manual confirmation steps
- Minimal-impact validation
- Evidence captured
- Vendor communication
- Remediation and retesting outcome
- Removal of identifiers and sensitive data
- No exaggerated impact claims

If the authorization or disclosure status cannot be clearly stated, it should remain retired.

### 3. Rate Limiting

**Restoration potential: Medium-high as an engineering article.**

Instead of a generic bypass list:

> **Testing Rate Limits Correctly: Identity, Windows, Concurrency, and Distributed State**

A modern rewrite could include:

- Fixed-window, sliding-window, token-bucket, and leaky-bucket models
- User, session, API key, device, and IP identities
- Trusted proxy and forwarded-header boundaries
- Race conditions and concurrent requests
- Distributed counters and atomicity
- `Retry-After` and rate-limit headers
- Fail-open versus fail-closed decisions
- A small reproducible local lab
- Defensive test cases

It should remove the incorrect implication that ordinary TCP clients can spoof source IPs and receive responses.

### 4. SSRF

**Restoration potential: Medium-high if rewritten defensively.**

A strong modern version could be:

> **Designing SSRF-Resistant Fetchers: URL Parsing, DNS Resolution, Redirects, and Cloud Metadata**

It should focus on:

- URL parser ambiguity
- Scheme restrictions
- DNS resolution and rebinding
- Redirect revalidation
- IPv4/IPv6 normalization
- Private, loopback, link-local, and special-use networks
- Cloud metadata protections, including IMDSv2
- Egress controls
- Proxy architecture
- A tested allowlist/denylist implementation
- Unit-test cases for bypass attempts

The old payload-heavy, malformed “Part 1” version should not return unchanged.

### 5. Subdomain Takeover

**Restoration potential: Medium, but only with a confirmed case or a false-positive angle.**

The old post did not establish a takeover. The most honest rewrite would be:

> **I Thought I Found a Subdomain Takeover. Here’s Why It Was a False Positive.**

That could become useful by explaining:

- CNAME and service-claim relationships
- Provider fingerprints
- Domain verification records
- Why arbitrary TXT records do not inherently prevent takeover
- How to distinguish dangling DNS from a claimable resource
- Modern provider protections
- Safe validation boundaries
- A decision tree for triage

This would fit your newer style of documenting when your initial conclusion was wrong.

### 6. NoSQL Injection

**Restoration potential: Medium.**

It would need a real lab and narrower scope:

> **MongoDB Operator Injection in Practice: Reproduction, Root Cause, and Typed Defenses**

Necessary improvements:

- Clearly scope it to MongoDB/operator injection
- Use valid, formatted request examples
- Explain query construction precisely
- Show typed schema validation
- Reject unexpected operators
- Discuss authorization separately from injection
- Avoid presenting every NoSQL database as equivalent
- Cite PortSwigger or other training sources where applicable
- Include a reproducible local demo and tests

Without original experimentation, this remains too generic for the curated archive.

### 7. Shellshock

**Restoration potential: Medium-low, unless you perform new research.**

A worthwhile version would require a current measurement:

> **Is Shellshock Still Exposed in 2026? Measuring Legacy CGI Risk Safely**

That would need:

- A lawful dataset or owned test environment
- Clear fingerprinting limitations
- No assumption that an Apache version proves Shellshock
- Current exposure counts
- Safe detection rather than command-execution payloads
- Modern containment and remediation guidance
- Historical context with primary sources

A generic Shellshock retrospective is not strong enough to restore.

### 8. Reverse DNS

**Restoration potential: Medium-low as part of a larger telemetry article.**

It could become:

> **What PTR, RDAP, ASN, and Forward DNS Actually Tell You About an Attacker IP**

This would fit your honeypot work if it compares:

- PTR records
- Forward-confirmed reverse DNS
- RDAP/RIR ownership
- ASN and hosting-provider attribution
- Geolocation limitations
- Why a hostname does not establish ownership or identity
- How ShardLure enriches IP information

This is better as a section in a threat-intelligence article than a standalone primer.

---

## Posts that should probably remain retired

### FlashCrawler v2

It primarily promoted another person’s tool and had unclear authorship value. Restore it only if you personally contributed significant engineering work and can explain that contribution precisely.

### Stored HTML Injection in a Chatbot

The vendor already knew about the issue, and the existing evidence did not establish meaningful impact. A new post would need a distinct discovery, clear rendering context, sanitization analysis, CSP analysis, and responsible disclosure outcome.

### Mastering Nmap

The topic is saturated, and authoritative Nmap documentation is better than another command roundup. It would only be worth restoring around original measurement, automation, detection research, or a unique lab.

### SQLMap Guide

A generic SQLMap walkthrough adds limited portfolio value and can encourage overly aggressive testing defaults. SQLMap could instead appear briefly inside an authorized SQL-injection case study.

### Sweet Security Disaster

The existing post lacked a clear disclosure and remediation outcome. Restore it only if you can establish authorization, vendor notification, impact boundaries, and resolution.

### Pre-Account Takeover

The removed version was generic. It should only return if tied to an original finding, a reproducible application flaw, or a rigorous lab demonstrating a specific pre-hijacking pattern.

### Sensitive Information Disclosure

The removed version was also generic. This topic would be stronger as an evidence-driven case study covering one concrete leak, its threat model, remediation, and retest.

---

## Already preserved for rewriting

These four were **not deleted**. They are stored as drafts and are the highest-priority restoration queue:

1. **From Dorks to Defense**
2. **Business Logic: Broken**
3. **Why IDORs Are Everywhere**
4. **XSS Meets IDOR**

They already contain firsthand material and should be rewritten before reviving generic tutorials.

## Recommended restoration order

1. **From Dorks to Defense**
2. **Why IDORs Are Everywhere**
3. **Business Logic: Broken**
4. **XSS Meets IDOR**
5. **From Shodan to SQLi**, if authorization/disclosure can be documented
6. **Subdomain Takeover**, reframed as a false-positive investigation
7. **SSRF**, rebuilt as a defensive engineering guide
8. **Rate Limiting**, rebuilt around implementation and test design

That path would grow the blog without diluting its new focus on original findings, measured telemetry, and tools you actually built.
---END---
LINE 118 PATH /request/messages/56/content

## Removed blogs

A total of **15 posts** were deleted from the content directory.

### Removed earlier at your request

1. **The Silent Threat: Understanding Pre-Account Takeover Attacks**
   - `pre-account-takeover.md`

2. **When Data Whispers Secrets: Understanding Sensitive Information Disclosure in Modern Systems**
   - `sensitive-information-disclosure.md`

### Removed during the editorial curation

3. **FlashCrawler v2.0**
   - `flashcrawler-v2.md`

4. **Google Dorks: The Power of Advanced Search Operators**
   - `google-dorks-guide.md`

5. **How We Discovered a Stored HTML Injection in a Chatbot System**
   - `html-injection-chatbot.md`

6. **Mastering Nmap: The Ultimate Guide to Port Scanning**
   - `mastering-nmap.md`

7. **NoSQL Injection: Exploitation Techniques and Attack Scenarios**
   - `nosql-injection.md`

8. **Rate Limiting: When Your Server Says Chill, Bro**
   - `rate-limiting-guide.md`

9. **Understanding Reverse DNS**
   - `reverse-dns-guide.md`

10. **Shellshock: The Bash Bug That Shook the Internet**
    - `shellshock-bash-bug.md`

11. **SQLMap: The Ultimate Guide to Automated SQL Injection Testing**
    - `sqlmap-ultimate-guide.md`

12. **SSRF: When Your Server Becomes a Nosy Hacker — Part 1**
    - `ssrf-server-side-request-forgery.md`

13. **Subdomain Takeover: When Your Own Domain Becomes Your Enemy**
    - `subdomain-takeover.md`

14. **Sweet Security Disaster**
    - `sweet-security-disaster.md`

15. **From Shodan to SQLi: Hacking an Exposed Company Dashboard**
    - `from-shodan-to-sqli.md`

All of these remain recoverable from Git history.

---

## Best candidates to rewrite and restore

These removed posts have enough potential for a substantially better version.

### 1. Google Dorks Guide

**Restoration potential: High—but not as another operator list.**

The strongest version would be a methodology article:

> **How I Turn Recon Queries Into Responsible Vulnerability Reports**

It could cover:

- How you define an authorized search scope
- How you remove duplicates and false positives
- How you move from an indexed page to a reproducible finding
- How you preserve evidence without collecting sensitive data
- How you report and verify remediation
- Lessons from your CERT-In experience
- Current operators only, verified against Google documentation

It should avoid credential-search examples, exposed-camera queries, and unsupported breach stories. Some of this material may be better incorporated into the draft **From Dorks to Defense** rather than restored as a separate article.

### 2. From Shodan to SQLi

**Restoration potential: High if authorization and disclosure can be documented.**

A strong rewrite would be:

> **From Exposed Service to Validated SQL Injection: A Responsible Assessment Workflow**

It needs:

- Explicit authorization or disclosure context
- What Shodan revealed—and what it did not prove
- Manual confirmation steps
- Minimal-impact validation
- Evidence captured
- Vendor communication
- Remediation and retesting outcome
- Removal of identifiers and sensitive data
- No exaggerated impact claims

If the authorization or disclosure status cannot be clearly stated, it should remain retired.

### 3. Rate Limiting

**Restoration potential: Medium-high as an engineering article.**

Instead of a generic bypass list:

> **Testing Rate Limits Correctly: Identity, Windows, Concurrency, and Distributed State**

A modern rewrite could include:

- Fixed-window, sliding-window, token-bucket, and leaky-bucket models
- User, session, API key, device, and IP identities
- Trusted proxy and forwarded-header boundaries
- Race conditions and concurrent requests
- Distributed counters and atomicity
- `Retry-After` and rate-limit headers
- Fail-open versus fail-closed decisions
- A small reproducible local lab
- Defensive test cases

It should remove the incorrect implication that ordinary TCP clients can spoof source IPs and receive responses.

### 4. SSRF

**Restoration potential: Medium-high if rewritten defensively.**

A strong modern version could be:

> **Designing SSRF-Resistant Fetchers: URL Parsing, DNS Resolution, Redirects, and Cloud Metadata**

It should focus on:

- URL parser ambiguity
- Scheme restrictions
- DNS resolution and rebinding
- Redirect revalidation
- IPv4/IPv6 normalization
- Private, loopback, link-local, and special-use networks
- Cloud metadata protections, including IMDSv2
- Egress controls
- Proxy architecture
- A tested allowlist/denylist implementation
- Unit-test cases for bypass attempts

The old payload-heavy, malformed “Part 1” version should not return unchanged.

### 5. Subdomain Takeover

**Restoration potential: Medium, but only with a confirmed case or a false-positive angle.**

The old post did not establish a takeover. The most honest rewrite would be:

> **I Thought I Found a Subdomain Takeover. Here’s Why It Was a False Positive.**

That could become useful by explaining:

- CNAME and service-claim relationships
- Provider fingerprints
- Domain verification records
- Why arbitrary TXT records do not inherently prevent takeover
- How to distinguish dangling DNS from a claimable resource
- Modern provider protections
- Safe validation boundaries
- A decision tree for triage

This would fit your newer style of documenting when your initial conclusion was wrong.

### 6. NoSQL Injection

**Restoration potential: Medium.**

It would need a real lab and narrower scope:

> **MongoDB Operator Injection in Practice: Reproduction, Root Cause, and Typed Defenses**

Necessary improvements:

- Clearly scope it to MongoDB/operator injection
- Use valid, formatted request examples
- Explain query construction precisely
- Show typed schema validation
- Reject unexpected operators
- Discuss authorization separately from injection
- Avoid presenting every NoSQL database as equivalent
- Cite PortSwigger or other training sources where applicable
- Include a reproducible local demo and tests

Without original experimentation, this remains too generic for the curated archive.

### 7. Shellshock

**Restoration potential: Medium-low, unless you perform new research.**

A worthwhile version would require a current measurement:

> **Is Shellshock Still Exposed in 2026? Measuring Legacy CGI Risk Safely**

That would need:

- A lawful dataset or owned test environment
- Clear fingerprinting limitations
- No assumption that an Apache version proves Shellshock
- Current exposure counts
- Safe detection rather than command-execution payloads
- Modern containment and remediation guidance
- Historical context with primary sources

A generic Shellshock retrospective is not strong enough to restore.

### 8. Reverse DNS

**Restoration potential: Medium-low as part of a larger telemetry article.**

It could become:

> **What PTR, RDAP, ASN, and Forward DNS Actually Tell You About an Attacker IP**

This would fit your honeypot work if it compares:

- PTR records
- Forward-confirmed reverse DNS
- RDAP/RIR ownership
- ASN and hosting-provider attribution
- Geolocation limitations
- Why a hostname does not establish ownership or identity
- How ShardLure enriches IP information

This is better as a section in a threat-intelligence article than a standalone primer.

---

## Posts that should probably remain retired

### FlashCrawler v2

It primarily promoted another person’s tool and had unclear authorship value. Restore it only if you personally contributed significant engineering work and can explain that contribution precisely.

### Stored HTML Injection in a Chatbot

The vendor already knew about the issue, and the existing evidence did not establish meaningful impact. A new post would need a distinct discovery, clear rendering context, sanitization analysis, CSP analysis, and responsible disclosure outcome.

### Mastering Nmap

The topic is saturated, and authoritative Nmap documentation is better than another command roundup. It would only be worth restoring around original measurement, automation, detection research, or a unique lab.

### SQLMap Guide

A generic SQLMap walkthrough adds limited portfolio value and can encourage overly aggressive testing defaults. SQLMap could instead appear briefly inside an authorized SQL-injection case study.

### Sweet Security Disaster

The existing post lacked a clear disclosure and remediation outcome. Restore it only if you can establish authorization, vendor notification, impact boundaries, and resolution.

### Pre-Account Takeover

The removed version was generic. It should only return if tied to an original finding, a reproducible application flaw, or a rigorous lab demonstrating a specific pre-hijacking pattern.

### Sensitive Information Disclosure

The removed version was also generic. This topic would be stronger as an evidence-driven case study covering one concrete leak, its threat model, remediation, and retest.

---

## Already preserved for rewriting

These four were **not deleted**. They are stored as drafts and are the highest-priority restoration queue:

1. **From Dorks to Defense**
2. **Business Logic: Broken**
3. **Why IDORs Are Everywhere**
4. **XSS Meets IDOR**

They already contain firsthand material and should be rewritten before reviving generic tutorials.

## Recommended restoration order

1. **From Dorks to Defense**
2. **Why IDORs Are Everywhere**
3. **Business Logic: Broken**
4. **XSS Meets IDOR**
5. **From Shodan to SQLi**, if authorization/disclosure can be documented
6. **Subdomain Takeover**, reframed as a false-positive investigation
7. **SSRF**, rebuilt as a defensive engineering guide
8. **Rate Limiting**, rebuilt around implementation and test design

That path would grow the blog without diluting its new focus on original findings, measured telemetry, and tools you actually built.
---END---
LINE 119 PATH /request/messages/54/content

## Removed blogs

A total of **15 posts** were deleted from the content directory.

### Removed earlier at your request

1. **The Silent Threat: Understanding Pre-Account Takeover Attacks**
   - `pre-account-takeover.md`

2. **When Data Whispers Secrets: Understanding Sensitive Information Disclosure in Modern Systems**
   - `sensitive-information-disclosure.md`

### Removed during the editorial curation

3. **FlashCrawler v2.0**
   - `flashcrawler-v2.md`

4. **Google Dorks: The Power of Advanced Search Operators**
   - `google-dorks-guide.md`

5. **How We Discovered a Stored HTML Injection in a Chatbot System**
   - `html-injection-chatbot.md`

6. **Mastering Nmap: The Ultimate Guide to Port Scanning**
   - `mastering-nmap.md`

7. **NoSQL Injection: Exploitation Techniques and Attack Scenarios**
   - `nosql-injection.md`

8. **Rate Limiting: When Your Server Says Chill, Bro**
   - `rate-limiting-guide.md`

9. **Understanding Reverse DNS**
   - `reverse-dns-guide.md`

10. **Shellshock: The Bash Bug That Shook the Internet**
    - `shellshock-bash-bug.md`

11. **SQLMap: The Ultimate Guide to Automated SQL Injection Testing**
    - `sqlmap-ultimate-guide.md`

12. **SSRF: When Your Server Becomes a Nosy Hacker — Part 1**
    - `ssrf-server-side-request-forgery.md`

13. **Subdomain Takeover: When Your Own Domain Becomes Your Enemy**
    - `subdomain-takeover.md`

14. **Sweet Security Disaster**
    - `sweet-security-disaster.md`

15. **From Shodan to SQLi: Hacking an Exposed Company Dashboard**
    - `from-shodan-to-sqli.md`

All of these remain recoverable from Git history.

---

## Best candidates to rewrite and restore

These removed posts have enough potential for a substantially better version.

### 1. Google Dorks Guide

**Restoration potential: High—but not as another operator list.**

The strongest version would be a methodology article:

> **How I Turn Recon Queries Into Responsible Vulnerability Reports**

It could cover:

- How you define an authorized search scope
- How you remove duplicates and false positives
- How you move from an indexed page to a reproducible finding
- How you preserve evidence without collecting sensitive data
- How you report and verify remediation
- Lessons from your CERT-In experience
- Current operators only, verified against Google documentation

It should avoid credential-search examples, exposed-camera queries, and unsupported breach stories. Some of this material may be better incorporated into the draft **From Dorks to Defense** rather than restored as a separate article.

### 2. From Shodan to SQLi

**Restoration potential: High if authorization and disclosure can be documented.**

A strong rewrite would be:

> **From Exposed Service to Validated SQL Injection: A Responsible Assessment Workflow**

It needs:

- Explicit authorization or disclosure context
- What Shodan revealed—and what it did not prove
- Manual confirmation steps
- Minimal-impact validation
- Evidence captured
- Vendor communication
- Remediation and retesting outcome
- Removal of identifiers and sensitive data
- No exaggerated impact claims

If the authorization or disclosure status cannot be clearly stated, it should remain retired.

### 3. Rate Limiting

**Restoration potential: Medium-high as an engineering article.**

Instead of a generic bypass list:

> **Testing Rate Limits Correctly: Identity, Windows, Concurrency, and Distributed State**

A modern rewrite could include:

- Fixed-window, sliding-window, token-bucket, and leaky-bucket models
- User, session, API key, device, and IP identities
- Trusted proxy and forwarded-header boundaries
- Race conditions and concurrent requests
- Distributed counters and atomicity
- `Retry-After` and rate-limit headers
- Fail-open versus fail-closed decisions
- A small reproducible local lab
- Defensive test cases

It should remove the incorrect implication that ordinary TCP clients can spoof source IPs and receive responses.

### 4. SSRF

**Restoration potential: Medium-high if rewritten defensively.**

A strong modern version could be:

> **Designing SSRF-Resistant Fetchers: URL Parsing, DNS Resolution, Redirects, and Cloud Metadata**

It should focus on:

- URL parser ambiguity
- Scheme restrictions
- DNS resolution and rebinding
- Redirect revalidation
- IPv4/IPv6 normalization
- Private, loopback, link-local, and special-use networks
- Cloud metadata protections, including IMDSv2
- Egress controls
- Proxy architecture
- A tested allowlist/denylist implementation
- Unit-test cases for bypass attempts

The old payload-heavy, malformed “Part 1” version should not return unchanged.

### 5. Subdomain Takeover

**Restoration potential: Medium, but only with a confirmed case or a false-positive angle.**

The old post did not establish a takeover. The most honest rewrite would be:

> **I Thought I Found a Subdomain Takeover. Here’s Why It Was a False Positive.**

That could become useful by explaining:

- CNAME and service-claim relationships
- Provider fingerprints
- Domain verification records
- Why arbitrary TXT records do not inherently prevent takeover
- How to distinguish dangling DNS from a claimable resource
- Modern provider protections
- Safe validation boundaries
- A decision tree for triage

This would fit your newer style of documenting when your initial conclusion was wrong.

### 6. NoSQL Injection

**Restoration potential: Medium.**

It would need a real lab and narrower scope:

> **MongoDB Operator Injection in Practice: Reproduction, Root Cause, and Typed Defenses**

Necessary improvements:

- Clearly scope it to MongoDB/operator injection
- Use valid, formatted request examples
- Explain query construction precisely
- Show typed schema validation
- Reject unexpected operators
- Discuss authorization separately from injection
- Avoid presenting every NoSQL database as equivalent
- Cite PortSwigger or other training sources where applicable
- Include a reproducible local demo and tests

Without original experimentation, this remains too generic for the curated archive.

### 7. Shellshock

**Restoration potential: Medium-low, unless you perform new research.**

A worthwhile version would require a current measurement:

> **Is Shellshock Still Exposed in 2026? Measuring Legacy CGI Risk Safely**

That would need:

- A lawful dataset or owned test environment
- Clear fingerprinting limitations
- No assumption that an Apache version proves Shellshock
- Current exposure counts
- Safe detection rather than command-execution payloads
- Modern containment and remediation guidance
- Historical context with primary sources

A generic Shellshock retrospective is not strong enough to restore.

### 8. Reverse DNS

**Restoration potential: Medium-low as part of a larger telemetry article.**

It could become:

> **What PTR, RDAP, ASN, and Forward DNS Actually Tell You About an Attacker IP**

This would fit your honeypot work if it compares:

- PTR records
- Forward-confirmed reverse DNS
- RDAP/RIR ownership
- ASN and hosting-provider attribution
- Geolocation limitations
- Why a hostname does not establish ownership or identity
- How ShardLure enriches IP information

This is better as a section in a threat-intelligence article than a standalone primer.

---

## Posts that should probably remain retired

### FlashCrawler v2

## 2026-08-03 — Project 1 Task 7

Implemented the approved legacy-v1 migration boundary only. Added a strict, bounded import-only PBKDF2-HMAC-SHA-256/AES-256-GCM reader for the observed version-1 envelope (exactly 600,000 iterations, 16-byte salt, 12-byte IV, authenticated ciphertext, strict keys and bounded decoded size). Parsing uses WebCrypto and runtime schemas; it does not generate legacy envelopes or implement cryptographic primitives. Authentication and ciphertext-tamper failures share `AUTHENTICATION_FAILED`; malformed envelopes/plaintext, unsupported records, and unsupported settings have stable non-secret categories.

Mapping preserves the observed OTP issuer, label, normalized Base32 secret, algorithm, digits, period, HOTP counter, type/default TOTP semantics, note, tags, and creation time. Legacy non-UUID IDs are deterministically remapped to namespaced UUIDv5-shaped identifiers, with Ente entity-map and pending-operation account references remapped consistently. Ente material remains in a dedicated migration payload field and the destination contract accepts only OTP items. Observed whole-minute auto-lock settings, including the synthetic fixture value 7, are preserved under a strict 0–1,440 bound.

Added `MigrationService.inspect/start/verify/activate/retry` over clean storage and destination interfaces. `start` decrypts and validates the entire source before any destination write; mapping/reference failures reject the complete operation. The destination stages one complete payload, `verify` compares the full read-back payload and regenerated OTP code/counter parity at fixed deterministic times, and only `activate` may publish it. Durable persisted status contains only phase, item count, timestamp, and retry/export guidance. Failures retain the legacy `vault` and settings unchanged, write no partial destination payload before complete parsing, and require explicit retry. Completed retries are deterministic no-ops. The legacy source is never deleted or overwritten by Task 7.

Added strict privileged migration message schemas. Only full-page vault documents may inspect or control migration. Start/retry accept a bounded opaque credential token, never a password, key, record, OTP seed, or Ente credential. Status responses expose only availability, lifecycle phase, item count, and retry/export guidance; content contexts have no migration policy entry. No router/UI integration or Task 8 behavior was added.

Strict TDD evidence:

- Importer RED: focused suite failed before implementation because `../src/legacy-v1` did not exist. GREEN: 5/5 after bounded schema, WebCrypto reader, deterministic mapping, fixed-time OTP parity, failure normalization, and settings behavior.
- Migration service RED: focused suite failed because `migration-service` did not exist. GREEN: 5/5 for staged/verified/activated ordering, Ente reference preservation, all-or-nothing rejection, indistinguishable authentication failure, restart/retry, idempotent completion, non-secret durable status, and unchanged legacy source.
- Messaging RED: focused suite failed because `migration.ts` did not exist. GREEN: 2/2 for strict privileged requests, opaque credential tokens, forbidden password/full-record fields, and bounded status projections.
- Settings compatibility correction RED: 2 expected failures showed the observed value 7 was rejected by the initial discrete current-UI policy. Minimal correction accepts strict whole minutes through 1,440; combined focused GREEN was 3 files / 12 tests.
- Browser migration gate: 1/1 passed using a fresh temporary synthetic Chromium profile; it proved a deterministic encrypted legacy `vault` remains byte-equal while a new durable root is configured. No real profile, account, clipboard, or personal data was accessed.

Verification with pinned pnpm 10.14.0 on installed Node 24.18.0 under the documented development exception:

- Focused Task 7: 3 files / 12 tests PASS.
- TypeScript, ESLint, and complete Prettier check PASS.
- Full source suite: 52 files / 771 tests PASS.
- Dependency-cruiser: PASS, 143 modules / 360 dependencies, no violations.
- Production dependency audit: PASS, no known vulnerabilities.
- Production security build: PASS; generated-output security tests 7/7 and semantic build scan PASS. Existing third-party Vite `use client` and empty-chunk notices remain non-failing.
- Browser regression: the wrapper `test:browser:built` stopped before tests because its nested command resolved host pnpm 10.34.4 under Node 24. The exact underlying gates were run directly with pinned pnpm 10.14.0: crypto test build PASS and Playwright 12/12 PASS; the new focused migration browser gate separately passed 1/1. No browser test failure occurred.
- Legacy fixture/hash test: 8/8 PASS. Independent final comparison confirmed all 17 preserved artifact hashes match the baseline byte-for-byte.

Self-review against Task 7 and standing boundaries: write-new/verify/activate ordering is enforced by the destination interface and service phase checks; supported records/settings/Ente references are preserved; unsupported/malformed inputs fail closed before staging; restart requires explicit deterministic retry; completion retry is idempotent; legacy data is not deleted or overwritten; durable status and messages are non-secret; no content-script surface, logging, snapshot, accessibility label, test name, or fixture filename contains seeds, keys, credentials, plaintext, or full records; no real user source was accessed; no manual crypto, package-engine change, Task 8 work, Git command, commit, or artifact edit occurred. Official Node 22 evidence remains unclaimed.

- Project 1 Task 7: COMPLETE pending review
  - Focused: 12/12; source: 771/771; output security: 7/7; browser: existing 12/12 plus migration 1/1
  - Static/build/dependency/audit gates: PASS under documented Node 24 exception
  - Legacy artifacts: 17/17 hashes byte-for-byte unchanged
  - Commits: skipped as required because this is not a Git repository

## 2026-08-03 — Project 1 Task 7 recovery / review fix round 1 (partial; not complete)

Recovered an interrupted, unverified working tree without Git. Inventory used Task 7 lines 397–441 of the Project 1 plan, the prior Task 7 ledger entry, package manifests/lockfile, file timestamps, all importer/messaging/service/browser tests, and the generation/repository/session/platform architecture. The incomplete round had created `migration-destination.ts` and its test after the prior ledger entry, and had partially rewritten `migration-service.ts`, importer schema/crypto/mapping/tests, storage generation/repository exports, and extension package dependencies. The exact baseline was broken: focused Vitest loaded 3 files / 13 tests but could not load `migration-service.test.ts` because `@noble/hashes/sha2.js` was not resolvable from the extension; `pnpm typecheck` reported that missing dependency plus the removed `MigrationDestination` contract and six fake-destination incompatibilities. The checked-in `crypto.ts` was also physically truncated (it began with `} from "./schema";` and contained an ellipsis token), despite importer tests passing against stale transform/cache state.

Recovery and TDD evidence:

- Restored the complete import-only WebCrypto legacy reader and direct extension dependency/linkage, then restored a structural `MigrationDestination` contract so service tests compile against fakes while production can use the concrete destination. The first post-recovery service run was RED 2/5 because old tests still asserted a removed standalone status key; the sound assertion was changed to the non-secret service projection. Focused GREEN is 6 files / 44 tests.
- Importer hardening already present in the partial round was inspected rather than assumed: canonical Base64 grammar, encoded-length/padding/decoded-size checks run in Zod before `atob`; password UTF-8 is counted before `TextEncoder`; timestamp milliseconds stop at the valid ECMAScript Date maximum and map failures to `UNSUPPORTED_LEGACY_RECORD`; Ente mappings reject duplicate account mappings, create-with-remote identity, and mismatched/dangling update/delete references. Existing RED/GREEN tests prove these boundaries. Independent parity was corrected from mapper-vs-same-mapper comparisons to literal deterministic fixture outputs and exact field projections, including TOTP, HOTP, and Steam. The initial literal field/output assertions produced expected RED failures until aligned with the authoritative fixture account semantics (not production changes).
- Added router RED for strict `MigrationRequestSchema`, full-page document policy, invalid token rejection, and migration-handler dispatch; GREEN routes only authorized vault documents and normalizes handler failures to safe vault-unavailable responses. This is router-level only: the background still does not instantiate a migration handler.
- Added local-storage access-level RED; GREEN calls both `chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })` and the existing session restriction during readiness, and fails closed if local access restriction is unavailable. This runs before the background accepts messages/ports. Chrome minimum remains 110 (API is available from 102); engines are unchanged.
- Browser diagnosis found setup and migration gates timing out with `CHALLENGE_INVALID`: the reviewed Argon2 KDF exceeded the two-minute document-bound challenge on this Node/Chromium host. Added RED proving a slow approved KDF needs a bounded five-minute window and expires immediately after it; raised only the opaque, document-bound challenge lifetime to five minutes. GREEN unit 9/9 and focused browser setup 1/1; full built Playwright 13/13.

Unclosed critical review scope (do not treat this round as approval):

- The concrete destination exists and focused tests pass, but it is not background-owned or reachable from the real trusted page. `installBackground` does not construct `EncryptedMigrationDestination`/`MigrationService`, no opaque credential resolver exists, and `SessionService` exposes no safe generation/root/epoch binding suitable for migration. The router integration therefore has no live handler.
- The full-page UI has no inspect/start/verify/activate/retry migration controls. The migration browser spec still only creates an empty vault and checks legacy/root coexistence; it does not migrate the fixture, verify fields/codes/settings/Ente references/read-back/item count/durable activation/retry, or prove content-script denial of all three local storage classes.
- Destination interruption coverage remains insufficient: its loop accepts any nominal phase, does not enumerate every write count dynamically, does not prove metadata/transaction identity and source/root/revision binding at each interruption, and does not authenticate committed-root reconciliation after a status-write failure. Metadata is encrypted but stored outside the generation, so root activation and metadata publication are not one atomic authenticated transaction. Transaction `expectedRoot`/`targetRoot` are parsed only during restore, verified phase persistence is not enforced before activation, and restart cannot reconstruct the staged payload/service state for verify/activate.
- Source serialization exists only per `MigrationService` instance. There is no background-global owner yet, and no exact concurrent-start/restart arbitration against durable transaction identity. The storage architecture explicitly lacks a true cross-owner CAS primitive; safety depends on one background owner and immediate root recheck. Completing this finding requires a narrow session-owned commit API that updates the session expected root after authenticated activation and reconciles root-write success/status-write failure, rather than bypassing `SessionService` or simulating CAS in UI.
- Legacy settings are encrypted into a migration-specific metadata key but are not applied to the real `SettingsService`; Ente state is not connected to a concrete OTP-only Ente store. Ente synthetic invariants are stricter than before but duplicate pending destructive operations and complete fixture-authorized semantics still need dedicated cases.
- The fixture manifest itself labels Steam runtime parity unverified. The importer now checks the recorded fixed literal, but the requested independent authoritative status cannot be upgraded without an approved deterministic legacy-runtime capture or an explicitly accepted compatibility source.

Commands and fresh results on Node 24.18.0 / pinned pnpm 10.14.0 (development exception only; Node 22 not claimed):

- Baseline `corepack pnpm@10.14.0 exec vitest run packages/importers/test/legacy-v1.test.ts packages/messaging/test/migration.test.ts apps/extension/test/background/migration-service.test.ts apps/extension/test/background/migration-destination.test.ts --maxWorkers=1`: FAIL, service suite load error; 3 files / 13 tests passed.
- Baseline `corepack pnpm@10.14.0 typecheck`: FAIL, 8 errors.
- Router RED: 1/16 expected failure; storage access RED: 1/10 expected failure; challenge lifetime RED: 1/9 expected failure.
- Focused GREEN: `corepack pnpm@10.14.0 exec vitest run packages/importers/test/legacy-v1.test.ts packages/messaging/test/migration.test.ts apps/extension/test/background/migration-service.test.ts apps/extension/test/background/migration-destination.test.ts apps/extension/test/background/router.test.ts apps/extension/test/platform/chrome-platform.test.ts --maxWorkers=1`: 6 files / 44 tests PASS.
- Correct serial full source command `corepack pnpm@10.14.0 exec vitest run --maxWorkers=1`: 53 files / 779 tests PASS. Earlier `pnpm test -- --maxWorkers=1` was diagnosed as forwarding the option after `--`, allowing worker contention and twice timing out the unrelated CSS-build test; isolated CSS test passed 2/2 and the correctly serialized full command passed.
- `typecheck`, ESLint, full Prettier check, and dependency-cruiser PASS (145 modules / 370 dependencies).
- `build:security` PASS; generated output 7/7 and semantic build scan PASS with only existing third-party Vite notices.
- `test:browser:built` PASS 13/13 after the bounded challenge-lifetime fix.
- `tests/legacy/fixtures.test.ts` PASS 8/8, including all 17 preserved artifact hashes byte-identical.
- No Git command or commit was used. Package engines and the 17 legacy files were unchanged.

- Project 1 Task 7 review fix round 1 recovery: PARTIAL / BLOCKED ON SAFE LIVE SESSION INTEGRATION
  - Recovered compile/test health and preserved sound importer/destination work
  - Closed: preallocation bounds, timestamp range, baseline Ente invariants, independent literal fixture checks, router policy unit integration, trusted local/session storage restriction, slow-KDF challenge expiry
  - Not closed: live background destination/credential/session binding, durable atomic metadata transaction and exhaustive interruption reconciliation, trusted-page migration UI, genuine browser migration/security projections, complete concurrency/CAS evidence
  - Commits: skipped as required

## 2026-08-03 — Project 1 Task 7 ordered substrate phase

Implemented only the approved first substrate phase; runtime migration ownership, credential messaging, router/UI wiring, migration controls, and browser migration E2E remain untouched. Generation format v3 adds exactly `migration-descriptor`, `lock-settings`, and `ente-otp-state` metadata names. Strict encrypted envelopes bind canonical AAD to generation ID, semantic name, and schema version; plaintext is bounded at 256 KiB and authenticated ciphertext at plaintext plus the 16-byte tag. V3 manifests authenticate metadata count plus canonical key/hash-sorted metadata entries. Stage/read/verify/nonce checks/key parsing/GC now include metadata. Version dispatch keeps exact v1 and v2 schemas/authentication and transactionally upgrades mutations to v3. The repository cursor dispatch was corrected from `=== 2` to every authenticated post-v1 format.

Importer now exposes `deriveLegacyVaultKey` and `decryptLegacyVaultWithDerivedKey`; only exact 32-byte derived keys are accepted. Password decryption delegates through this API and clears its mutable derived-key copy, while wrong key/password/tamper remain the same public authentication category and existing preallocation bounds remain in force. Ente validation rejects duplicate semantic pending keys `op\\0accountId\\0enteId-or-empty`, preserves ordered update then delete, and the Task-7-only `EnteOtpMetadataStore` validates entity/pending account references against migrated OTP IDs while returning only present/entity/pending/create/update/delete counts. Steam remains static fixture inference only.

`SessionService` now provides background-internal unlocked migration snapshots and a mutex/epoch/root-bound verified-generation commit. Commits reuse the existing activation candidate, exact-target authentication, expected-root update, root-write-then-throw reconciliation, and unexpected-root lock behavior. Lock invalidates snapshots and invokes registered cleanup callbacks. The unused raw `getDataKey` accessor was removed. Lock settings schemas/services now accept only safe integers 0–1,440; existing UI options were not edited. `applyMigrated` is idempotent and schedules exact fixture value 7.

Strict TDD evidence: generation metadata RED was 1 file / 4 expected failures (missing names/API, duplicate acceptance, absent manifest entries, absent GC method assumption); GREEN after correcting the test to existing `collect` was 3 files / 12 tests. Importer RED was 2 files / 3 expected failures (missing derived-key APIs and duplicate acceptance); GREEN 2 files / 11 tests. Session RED was 1 file / 2 expected failures (missing snapshot/commit and cleanup callback); GREEN 1 file / 11 tests. Settings RED was 1 file / 1 expected failure (`applyMigrated` absent); GREEN 1 file / 3 tests. Ente store RED was a missing-module suite; GREEN 1 file / 3 tests after a deterministic valid create fixture correction. Focused substrate/migration GREEN: 15 files / 136 tests. A full serial run first exposed two v3 adaptation regressions (post-v1 journal cursor dispatch and the now-valid integer 10 message fixture); focused regression GREEN was 2 files / 22 tests, then full serial source GREEN was 56 files / 792 tests.

Verification used pinned pnpm 10.14.0 on installed Node 24.18.0 under the documented development exception; official Node 22 evidence is not claimed. TypeScript, ESLint, full Prettier, dependency-cruiser (149 modules / 382 dependencies), production security build, generated-output 7/7, semantic build scan, and legacy fixtures 8/8 passed. The legacy test includes all 17 preserved artifact hashes; no artifact, package engine, dependency, lockfile, UI, router, browser test, or Git state was changed. Existing third-party Vite `use client` and empty-chunk notices remain non-failing. No Git command or commit was used.

Self-review: v1/v2/v3 schema dispatch is explicit; metadata AAD and manifest count/key/hash/ciphertext/name/generation tamper paths fail closed; bounds are authenticated before plaintext projection; metadata nonces participate in candidate/retained/manifest/marker collision checks; the session commit is serialized with password rotation and lock epochs, updates expected root only after authenticating the exact target, and conservatively locks ambiguous or competing roots; public messages/logs expose no password, seed, code, full item, Ente credential, DEK, or root.

- Project 1 Task 7 ordered substrate phase: COMPLETE pending review
  - Focused: 136/136; full serial source: 792/792; output security: 7/7
  - Static/build/dependency/legacy gates: PASS under documented Node 24 exception
  - Residual integration: background-owned migration construction/credential lifecycle, concrete destination conversion to generation metadata/session commit, trusted-page UI/router ownership, and browser migration E2E remain later ordered phases
  - Commits: skipped as required

## 2026-08-03 — Project 1 Task 7 substrate fix round 1

Addressed all eight substrate review findings without Git, router/UI/browser runtime work, credential messaging, package changes, engine changes, or legacy artifact edits.

Root-cause mapping and fixes:

- Mutex deadlock: `commitMigration`/setup held `mutationMutex`, while ambiguous `commitRoot` called public `lock()`, which queued behind the held mutex. Public lock now increments epoch and runs exception-contained cleanup callbacks immediately, then queues clearing; `lockWhileMutationHeld` performs the same invalidation/clear path without reacquiring. Timeout-backed root-write-then-throw and competing-root tests settle and prove locked state.
- Ambiguous exact-target authentication: raw root equality could report committed after unauthenticated corruption. Reconciliation now authenticates the exact candidate generation, manifest, verified marker, root binding, records, receipts, and metadata with the current DEK before returning committed/locked. Missing marker, tampered manifest or metadata-class data, root-read failure, and competing root lock and return the existing safe `VAULT_LOCKED` failure instead of claiming commitment.
- Capability boundary: removed the DEK-bearing `UnlockedMigrationSnapshot.context` interface. `beginMigration` returns an opaque object containing only non-secret epoch and active-generation binding; identity is validated through a private `WeakMap`, so copies and forgeries fail. `stageMigration`, `readMigration`, and `commitMigration` own all contexts, encryption, verification, metadata crypto, and activation internally. Stage references are likewise identity-bound and expose only generation ID. Lock/root change invalidates capabilities and references.
- Destination bypass: `EncryptedMigrationDestination` no longer imports or constructs `GenerationStore`, receives no `VaultCryptoContext`, root, DEK, or assertion closure, and cannot call direct activation. It invokes only narrow session migration methods. Its durable transaction projection no longer stores roots.
- Metadata preservation: repository load/commit carries all authenticated v3 metadata. Each mutation decrypts validated plaintext and re-encrypts it for the new generation ID, so generation-bound AAD remains valid and envelopes/nonces are not copied. CRUD and HOTP paths include metadata in retained nonce accounting. Tests run create/update/delete over all three semantics and authenticate equality after GC.
- Metadata AAD: canonical AAD now includes domain, actual format, actual formatVersion, generationId, name, and schemaVersion. An independent literal vector and explicit format/version/name/generation/ciphertext tamper cases cover it.
- Ente ordering: duplicate semantic keys remain rejected; an account/entity target becomes terminal after delete. Delete-then-update, repeated delete, and post-delete update are rejected, while ordered update then delete and input order are preserved. Creates remain conservatively valid only without remote identity and for an unmapped local account, matching observed constraints.
- Capacity: removed misleading `MAX_VAULT_RECORDS = 100000`. `MAX_GENERATION_ENTRIES = 10000` is authoritative across records, journal, receipts, and metadata. Exported `generationEntryCount` validates nonnegative safe-integer class counts and preflights before metadata encryption or writes; repository and migration use `GenerationStore.stage`, so the same preflight applies. Boundary tests use counts only and include metadata without allocation-heavy fixtures.

Strict TDD evidence:

- Session/capability RED: 1 file / 4 expected failures: missing opaque API plus three 250 ms deadlock timeouts. GREEN: 1 file / 14 tests, including root-write-then-throw, missing marker, tampered manifest, root-read failure, competing root, callback containment, stale/copy capability rejection, and locked state.
- Destination RED: 1 file / 2 expected failures because the old constructor attempted to call a `SessionService` as the raw binding function. GREEN: destination + session 2 files / 17 tests with no raw context/direct activation interface.
- Repository metadata RED: 1 file / 1 expected failure; active metadata was empty after mutations. GREEN: 1 file / 17 tests after authenticated decrypt/re-encrypt preservation. Focused storage initially exposed two HOTP call-site argument regressions; after correction, focused storage/importer/session/destination/service passed 13 files / 137 tests.
- AAD RED: 1 file / 1 expected failure because `metadataAssociatedData` did not exist. GREEN: 1 file / 5 tests with the independent exact canonical vector and format/version tamper cases.
- Ente ordering RED: 1 file / 1 expected failure because delete-then-update was accepted. GREEN: 1 file / 10 tests.
- Capacity RED: 1 file / 1 expected failure because `generationEntryCount` did not exist. GREEN: 1 file / 54 tests.

Fresh verification with pinned pnpm 10.14.0 on installed Node 24.18.0 under the documented development exception: full serial source 56 files / 799 tests PASS; TypeScript, ESLint, full Prettier, and dependency-cruiser PASS (149 modules / 383 dependencies, no violations); production security build PASS; generated output 7/7 PASS; semantic build scan PASS; legacy fixture/hash suite 8/8 PASS including all 17 preserved artifact hashes; production audit reports no known vulnerabilities. Existing third-party Vite `use client` and empty-chunk notices remain non-failing. Official Node 22 evidence is not claimed. No Git command or commit was used.

Self-review: v1/v2 readers and authentication dispatch remain unchanged; no raw DEK/context/root-bearing capability crosses the migration boundary; destination activation is structurally session-owned; ambiguous writes authenticate exact target before any committed result; internal lock cannot reacquire its held mutex; metadata plaintext is preserved exactly but always re-encrypted for generation-bound AAD; capacity preflight occurs before migration/repository encryption writes; no secret fields enter messages, logs, errors, fixture names, or test names.

- Project 1 Task 7 substrate fix round 1: COMPLETE pending review
  - Focused: 137/137; full serial source: 799/799; output security: 7/7; legacy: 8/8
  - Static/build/dependency/audit gates: PASS under documented Node 24 exception
  - Residual integration: background construction/credential ownership, durable restart reconstruction of opaque stage references, settings/Ente application after authenticated activation, trusted-page UI/router ownership, and browser migration E2E remain later phases
  - Commits: skipped as required

## 2026-08-03 — Project 1 Task 7 substrate fix round 2

Closed the remaining password-rotation preservation finding only. Root cause: `SessionService.changePasswordInternal()` authenticated the active generation but staged only `records` and `journal`; it omitted `receipts` and `metadata`. Its retained nonce set likewise covered only active records, journal, manifest authentication, and marker, not receipts, metadata, or the previous retained generation. Consequently password rotation silently dropped HOTP idempotency receipts and all three authenticated metadata semantics, while fresh generated envelopes were not checked against the complete retained nonce domain.

Strict TDD RED: added one focused integration test that starts from a real unlocked v3 session, stages all three semantic metadata names and a HOTP item, commits one real idempotency receipt through `VaultRepository`, unlocks, rotates the password, relocks, proves the old key fails and the new key unlocks, authenticates the exact active generation, compares every metadata plaintext byte-for-byte by semantic name, and replays the original HOTP reservation without another write/counter increment. Before the production change, 1 file / 15 tests ran with exactly 1 expected failure: the authenticated active generation returned an empty metadata list instead of all three semantics; receipt replay would also have been unavailable after that assertion.

GREEN fix: rotation now reads both retained authenticated generations and includes every record, journal, receipt, metadata, manifest-authentication, and marker nonce in retained collision accounting. It decrypts each active metadata envelope through `GenerationStore.decryptMetadata`, preserving authenticated semantic plaintext exactly, and passes plaintext to `GenerationStore.stage` so v3 metadata is re-encrypted under the new generation ID/AAD with fresh nonces. It passes active receipts through unchanged because their authenticated AAD is receipt-hash/version bound rather than generation bound. `GenerationStore.stage` continues to enforce the single total record+journal+receipt+metadata entry cap before metadata encryption/writes. Any active/retained/metadata decrypt or authentication failure occurs before staging/activation, follows existing storage-error locking, and retains secret-safe `VAULT_LOCKED`/`INVALID_CREDENTIALS` projection. V1/v2 readers and exact behavior are unchanged; their metadata list remains empty and v2 receipts are preserved.

Evidence with pinned pnpm 10.14.0 on installed Node 24.18.0 under the documented exception: focused session GREEN 1 file / 15 tests; focused session/storage/HOTP/adapter 11 files / 131 tests PASS; full serial source 56 files / 800 tests PASS. TypeScript, ESLint, full Prettier, and dependency-cruiser PASS (149 modules / 383 dependencies, no violations). Production security build, generated output 7/7, and semantic build scan PASS. Legacy fixture/hash suite 8/8 PASS including all 17 preserved artifact hashes. Existing Vite third-party `use client` and empty-chunk notices remain non-failing. Official Node 22 evidence is not claimed. No Git command or commit was used.

Self-review: password rotation preserves receipts and exact metadata semantics; metadata envelopes are never copied across generation-bound AAD; fresh metadata and manifest/marker nonces are checked against the complete active+previous retained nonce set; receipt replay remains fully bound and idempotent after restart-like relock/unlock; old credentials fail; authentication/decrypt failures precede root activation; no password, DEK, seed, code, metadata plaintext, receipt payload, or root enters logs/messages/errors.

- Project 1 Task 7 substrate fix round 2: COMPLETE pending review
  - RED: 1/15 expected failure; GREEN focused: 15/15 and 131/131
  - Full serial source: 800/800; output security: 7/7; legacy: 8/8
  - Static/build/dependency gates: PASS under documented Node 24 exception
  - Changed scope: session rotation implementation, focused integration test, execution ledger only
  - Commits: skipped as required

## 2026-08-03 — Project 1 Task 7 document-bound credential phase

Implemented only the approved document-bound legacy credential authorization and strict migration messaging phase. Added a background-memory `MigrationCredentialService` that accepts only the exact browser-normalized full vault URL/context with a required document ID and captures extension ID, URL, document ID, and optional tab/frame values once. Challenge creation first obtains a current opaque `SessionService` migration capability, strictly parses the legacy version-1 envelope, retains only a SHA-256 source fingerprint plus capability/sender/expiry, and returns the observed PBKDF2-HMAC-SHA-256 parameters: canonical 16-byte salt, 600,000 iterations, 32 output bytes, opaque ID, and an explicit 30-second expiry. It never decrypts or returns the source.

Authorization destructively consumes the challenge before validation, accepts only canonical Base64 encoding of exactly 32 derived bytes, revalidates the same capability and exact source fingerprint, and stores one owned mutable key array under a one-use opaque token. `withCredential` removes the token before every attempt, revalidates exact sender, expiry boundary (`now >= expiresAt`), active capability identity/root binding, and exact source fingerprint before invoking a background-internal callback. The transient array is overwritten in `finally`, including callback rejection. Challenge/token mismatch, expiry, source/root/session change, lock, dispose, and restart all fail closed and consume/invalidate authorization. Lock cleanup is registered through `SessionService.onLockOrDispose`; cleanup is synchronous, idempotent, overwrites owned token arrays, and does not acquire the session mutex. No guaranteed JavaScript physical zeroization is claimed. Opaque ID allocation retries at most eight times and never overwrites a live challenge/token.

Extended the existing opaque migration capability API with `assertMigrationCapability(capability)`, which authenticates the live active root and requires the exact WeakMap-backed capability identity, epoch, and root binding. No root, DEK, storage context, or closure is exposed.

Migration messaging now has strict `zod/mini` discriminated requests for `migration.getCredentialChallenge` and `migration.authorizeCredential`, strict challenge/authorization/status response variants, and vault-document-only sender policies for every migration command. `start`/`retry` continue to carry only a 32-hex opaque credential token. The authorize request is the sole boundary carrying the canonical 32-byte derived legacy key. Strict objects reject passwords, seeds, source ciphertext, records, Ente material, arbitrary errors, roots, fingerprints, and all extra fields. The router now passes the exact authorized normalized sender to the optional migration handler and projects handler output through explicit response allowlists plus strict schemas, preventing raw extras from crossing the boundary. The handler remains optional and no `MigrationService`, UI, worker, durable workflow, destination, or browser integration was instantiated.

Strict TDD evidence:

- Messaging RED: 1 file / 3 tests ran with 2 expected failures because the new request discriminators and response variants did not exist. GREEN: 3/3 for strict commands, exact derived-key encoding/length, forbidden fields, sender policies, and challenge/authorization/status projections.
- Credential service RED: the focused suite failed at import because the service did not exist. A separate session RED was 1/15 expected failure because `assertMigrationCapability` did not exist. GREEN: credential/session 2 files / 22 tests, then 23/23 after the forged-label regression cycle.
- Router RED: 1/16 expected failure showed the handler received no sender and raw extra fields crossed unchanged. GREEN: 16/16 after exact sender forwarding and allowlisted projection.
- Forged-label RED: 1/8 expected failure showed a vault label paired with a popup/foreign URL could reach challenge creation when bypassing the router. GREEN: 8/8 after enforcing the exact `chrome-extension://<extensionId>/vault/index.html` tuple inside the service before session/source access.
- The first full invocation used an accidental extra `--` before `--maxWorkers=1`; 807 tests passed and one unrelated Vite CSS build exceeded its 5-second timeout. Isolated reproduction passed 2/2 in 3.92 seconds. The correct serial command and final rerun both passed; no product/test timeout change was made.

Verification used pnpm 10.14.0 with installed Node 24.18.0 under the documented development-only exception; official Node 22 evidence is not claimed. Final focused messaging/importer-derived-key/credential/session/router suites passed 9 files / 115 tests. Full serial source passed 57 files / 809 tests. TypeScript, ESLint, full Prettier, and dependency-cruiser passed (151 modules / 389 dependencies, no violations). Production security build passed, including generated-output 7/7 and semantic build scan; only existing third-party Vite `use client` and empty-chunk notices appeared. Preserved legacy artifact SHA-256 hashes were recomputed without editing the artifact. Dependencies, lockfile, engines, legacy artifacts, UI, browser profiles/accounts, clipboard, personal data, and Git state were unchanged. No Git command or commit was run.

Self-review: exact sender comparison includes optional tab/frame presence and values; sender proxy fields are captured once; challenge/token deletion precedes awaits and callbacks; active capability and source are checked immediately before callback release; callback exceptions cannot retain a live token and the owned array is overwritten in `finally`; lock cleanup cannot deadlock the session mutex; restart loses all in-memory maps; no source envelope/record/password is retained by the service; responses/errors/logs contain no source fingerprint, key, record, root, Ente value, or arbitrary exception text. Residual integration remains intentionally deferred: background construction/wiring, UI-side KDF worker use, adapting `MigrationService.start/retry` to consume derived keys through `withCredential`, durable stage reconstruction, destination/state/UI, and browser migration flows.

- Project 1 Task 7 document-bound credential phase: COMPLETE pending review
  - RED cycles: messaging 2/3 expected failures; service import failure; session 1/15; router 1/16; forged-label 1/8
  - GREEN focused: 115/115; full serial source: 809/809; output security: 7/7
  - Static/build/dependency/legacy-hash gates: PASS under documented Node 24 exception
  - Commits: skipped as required

## 2026-08-05 — Project 1 Task 7 credential review fix round 1 recovery

Recovered after the prior provider failure by inventorying the credential service, session capability API, migration messaging/router, importer schemas/tests, and the latest ledger entry before modifying production code. Baseline focused migration tests passed 7 files / 76 tests and baseline typecheck passed. The workspace contained substantial unledgered partial work: a shared bounded canonical Base64 validator with exact re-encoding; canonical migration-key, legacy salt/IV/ciphertext, and messaging validation; destructive challenge/token consumption; in-flight mutable-key tracking and synchronous lock/dispose invalidation generation; source snapshots/fingerprints; per-sender replacement; global map/in-flight capacity; expiry pruning; collision retry bounds; and race/capacity/ownership tests. That work was preserved only after focused and full verification. No package engine, dependency, lockfile, legacy artifact, UI, state-machine, real profile/account/clipboard, or personal-data access was changed or used.

Root-cause review found three remaining gaps. First, `withCredential` had an await gap after its final authenticated source read: root/session replacement while that read was paused could still release the callback because no synchronous exact-capability identity check existed immediately before callback invocation. Second, authorization checked the source before a final awaited capability validation but did not re-read the exact source afterward, so replacement during that final await could insert a credential. Third, concurrent challenge issuance was bounded only after awaits and had no explicit reservation counter; it happened to settle at 32 entries but did not make in-flight issuance part of the stated capacity invariant. Recovery also detected and immediately corrected an accidental local overwrite of this ledger while appending: all original 1,872 lines were reconstructed exactly from persisted ZCode transcript reads before this entry was added.

Strict TDD evidence:

- Consumption final-source/root RED: expanding the deferred matrix with root and expiry changes during the second source read produced 1 expected failure out of 27 credential tests: root replacement resolved the callback instead of rejecting. Adding a wished-for synchronous `assertMigrationCapabilityCurrent` session assertion produced 2 expected failures across credential/session (missing API plus the race). GREEN added an identity/epoch/root-binding synchronous assertion backed by the existing WeakMap and performs it, together with generation/disposed/expiry checks, immediately before callback release; 42/42 then passed.
- Authorization final-source RED: replacing storage while authorization was paused in its final capability await produced 1 expected failure out of 29: a credential token was inserted. GREEN re-reads and strictly parses the source after that await, checks the exact fingerprint, then synchronously checks exact capability identity and invalidation state before pruning/capacity/ID allocation/insertion; 44/44 credential/session passed.
- Explicit issuance-capacity RED: asserting an issuance-reservation member in the capacity invariant produced 1 expected failure (`NaN`) out of 29. GREEN reserves before the first await, includes pending issuance in the small global 32-operation bound, and releases in `finally`. The first GREEN test shape paused 33 reads although the 33rd request now correctly rejected before reading, causing an expected test timeout/unhandled rejection; the corrected behavioral test pauses the 32 admitted requests and observes the 33rd rejection, passing 29/29.
- Challenge cleanup RED: locking while challenge source reading was paused produced 1 expected failure out of 30 because issuance still completed after synchronous cleanup. GREEN captures invalidation generation before awaits and checks it/disposal after capability and source awaits, then synchronously checks the exact capability before challenge insertion; credential/session passed 45/45.

Review-finding mapping: (1) authorization now destructively consumes, registers decoded mutable key before awaits, is synchronously invalidated/cleared by lock/dispose, rechecks generation/disposal/expiry after every await, performs final exact source and synchronous exact-capability checks, and inserts nothing after cleanup; all exits clear/remove the transient operation unless ownership transfers to the credential. (2) consumption destructively consumes and registers first, validates exact sender/expiry/capability/source, re-reads the current source immediately before callback, synchronously rechecks exact capability plus generation/disposal/expiry, never rereads in the consumer callback, and always clears/removes in `finally`. Deferred tests cover lock, dispose, root/session replacement, source replacement, and expiry across capability and both storage waits. (3) challenges and credentials remain one per exact sender, replacement clears credential key bytes, expired entries are pruned before issuance/capacity/ID allocation, the explicit 32-operation bound includes pending issuance and key-bearing operations, and opaque ID collision retries remain capped at eight. (4) callback receives only the frozen strictly parsed legacy-envelope snapshot captured by the credential service and the transient mutable key; current storage is fingerprinted immediately before release. (5) the recovered shared validator bounds encoded length before decoding, enforces alphabet/padding/decoded length, exact-roundtrips to reject nonzero pad bits, clears rejected decoded bytes, and is used consistently by migration derived keys, legacy fixed fields/ciphertext, and messaging; existing alternate-encoding tests passed.

Fresh verification with pinned pnpm 10.14.0 on installed Node 24.18.0 under the documented development exception (official Node 22 not claimed): focused credential/messaging/session/router/importer/service/destination passed 8 files / 84 tests; full serial source passed 57 files / 831 tests; TypeScript, ESLint, full Prettier, and dependency-cruiser passed (152 modules / 393 dependencies, no violations); production security build passed with generated-output 7/7 and semantic scan; legacy fixture/hash suite passed 8/8, including all 17 preserved artifact hashes. Existing third-party Vite `use client` and empty-chunk notices remain non-failing. No Git command or commit was used.

- Project 1 Task 7 credential review fix round 1 recovery: COMPLETE pending review
  - RED cycles: consumption 1/27 then credential/session 2 failures; authorization 1/29; issuance capacity 1/29; challenge cleanup 1/30
  - GREEN focused: 84/84; full serial source: 831/831; output security: 7/7; legacy: 8/8
  - Static/build/dependency gates: PASS under documented Node 24 exception
  - Residual: official Node 22 environment not available; no product behavior residual identified in the requested credential round
  - Commits: skipped as required

## 2026-08-10 — Project 1 Task 7 durable state-machine recovery

Recovered after the prior provider failure by inventorying migration service/destination/session/storage/settings/Ente source and tests plus the latest ledger. Baseline typecheck failed on unused transaction-crypto imports and missing `SessionService.sealMigrationTransaction/openMigrationTransaction`; focused tests had exactly 1 failure out of 176 for the same missing API. The durable destination remained materially incomplete: plaintext transaction state, in-memory stage/capability maps, no descriptor, and no restart reconstruction.

Strict RED/GREEN evidence: the recovered session transaction test was RED 1/16 and typecheck failed; GREEN added an opaque DEK-owned authenticated transaction envelope bound to actual format/version/transactionId and restored session 16/16 plus typecheck. Destination recreation RED failed 1/3 with `TRANSACTION_INVALID`; GREEN added deterministic target generation reservation, authenticated descriptor metadata, verified-generation reconstruction through SessionService, and service recreation between verify/activate. Activation interruption RED failed 1/4; after lock-aware retry and active-target authentication, GREEN passed the complete before/after write matrix.

Implemented an encrypted/authenticated v2 transaction at `shardpass:v1:migration-transaction` with strict revision, eight internal phases, transaction/source/payload/expected-root/target/count/presence, lease owner/version/expiry, updated time, and safe-retry fields. Lease/version are restart/arbitration evidence only; no CAS or split-worker proof is claimed. OTP records plus migration descriptor and optional lock-settings/Ente metadata stage in one v3 generation. Restarted destination/service verification reconstructs only from the authenticated transaction and verified staged generation; activation retries authenticate an already-active exact target and avoid duplicate root commits. Public phases remain none/staged/verified/completed/failed. Legacy vault/settings keys are untouched.

Fresh verification on installed Node 24.18.0 with pinned pnpm 10.14.0 under the documented exception; official Node 22 not claimed: focused migration/importer/storage/settings/Ente suite 16 files / 177 tests PASS; full serial source 57 files / 833 tests PASS; TypeScript, ESLint, full Prettier, and dependency-cruiser PASS (152 modules / 394 dependencies); production security build, generated-output 7/7, and semantic scan PASS; legacy fixture/hash suite 8/8 PASS including all 17 preserved artifact hashes; production audit reports no known vulnerabilities. Existing third-party Vite `use client` and empty-chunk notices remain non-failing. No Git operation or commit was used.

1913 Honest residuals: main/router singleton construction, UI worker/panel, and browser migration E2E remain intentionally unwired. The service still exposes its legacy direct-password API rather than consuming `MigrationCredentialService.withCredential`; settings and Ente are authenticated in the active generation but final application through `SettingsService`/`EnteOtpMetadataStore` is not wired. Durable lease fields are authenticated but cross-document lease arbitration/conflict/expiry semantics are not yet exhaustively implemented. Tamper/conflict/retry matrices are not yet as exhaustive as the requested final specification. Workspace compile/tests/build are clean, but Task 7 durable phase is therefore PARTIAL rather than honestly complete.

## 2026-08-10 — Project 1 Task 7 credential lifecycle and authenticated finalization recovery

Recovered the abandoned partial workspace before production edits. The latest ledger honestly identified direct-password `MigrationService.start/retry`, absent production handler behavior, and missing settings/Ente finalization. Baseline focused migration/credential/session/settings/Ente/messaging tests passed 90/90, while typecheck failed on two unused imports left by the abandoned API conversion. Inspection confirmed credential source snapshots already bound the strict legacy envelope and strict parsed settings and re-read/recompared both before callback release; the durable destination already authenticated descriptors and supported restart reconstruction but marked an active target completed without applying active metadata.

Strict TDD evidence: handler RED failed 1/6 because `MigrationService.handle` did not exist and typecheck proved the constructor/API mismatch. GREEN replaced every service direct-password entry with strict `MigrationRequest` plus exact `SenderBinding`; `start` and failed/new `retry` consume the opaque token only through `MigrationCredentialService.withCredential`, and the callback decrypts only the immutable captured envelope with `decryptLegacyVaultWithDerivedKey`. Staged verify and verified/finalizing activate/retry require no token or in-memory payload. Wrong-key and authenticated tamper retain the same `AUTHENTICATION_FAILED` result, and service status responses are strict bounded projections without credential/source/key/record fields. A source-binding correction was driven by focused failures: final activation now reconstructs the same full strict envelope+settings fingerprint rather than the old raw storage-object fingerprint, so exact settings changes are rejected.

Authenticated finalization now reads the exact active generation through `SessionService.readActiveMigration`, validates descriptor/payload/target generation, applies active `lock-settings` through idempotent `SettingsService.applyMigrated`, validates active `ente-otp-state` through `EnteOtpMetadataStore`, and retains only its safe counts projection. Transaction copies are not used for finalization data. `finalizing` or already-active `activating` restart paths authenticate and reapply before writing completed. A focused recovery test injects settings scheduling failure after root commit, recreates the destination, reapplies exact value 7, validates safe Ente counts/no credentials, and proves zero second active-root writes.

Fresh verification on installed Node 24.18.0 with pinned pnpm 10.14.0 under the documented development exception; official Node 22 is not claimed: focused migration/importer/credential/session/settings/Ente/messaging/router passed 10 files / 93 tests; full serial source passed 57 files / 834 tests; TypeScript, ESLint, full Prettier, and dependency-cruiser passed (152 modules / 397 dependencies, no violations); production security build, generated output 7/7, and semantic build scan passed; legacy fixture/hash plus generated security suites passed 87/87, including all 17 preserved artifact hashes. Existing third-party Vite `use client` and empty-chunk notices remain non-failing. Engines, dependencies, lockfile, UI/browser/main singleton, legacy artifacts, real profiles/accounts/clipboard, and Git state were not changed or used.

Honest residuals: cross-document lease arbitration/conflict/expiry semantics remain non-CAS evidence rather than exhaustive split-worker proof, and the full durable transaction/descriptor tamper and conflict matrix remains less exhaustive than the final specification. UI/browser/main singleton wiring remains intentionally deferred as requested. No Git operation or commit was used.

## 2026-08-10 — Project 1 Task 7 durable arbitration and tamper completion

Completed the remaining source-only durable arbitration hardening without main/UI/browser wiring, Git, dependencies, engine changes, or legacy artifact edits. The authenticated v2 transaction owner is now exactly `{ instanceId, leaseId, leaseVersion, expiresAt }`. One module-wide transaction mutex serializes all destination/service instances in a background worker, while per-service mutexes continue serializing public operations. Fresh starts refuse any authenticated existing transaction before reserving or staging another generation. A non-expired foreign owner receives only `MIGRATION_IN_PROGRESS` and causes no write. Expired takeover first authenticates the current session/root and exact staged or active target descriptor/payload, then increments transaction revision and leaseVersion before continuing. Same-owner writes re-read and reject detectable stale transaction/revision/lease identity. Exact candidate/active authentication and session-owned root commit remain unchanged; unexpected roots never get overwritten.

Strict RED/GREEN evidence:

- Foreign live lease RED: 1/6 failed because a second owner verified the transaction. GREEN: foreign live lease denied with zero writes; after deterministic expiry, exact authenticated target takeover verified without activation.
- Competing stage RED: 1/7 failed because the second owner attempted a new transaction and reached invalid generation allocation. GREEN: the authenticated existing transaction is rejected as `MIGRATION_IN_PROGRESS` before reservation/staging, with the first stage remaining usable.
- Same-owner concurrency RED: 1/8 showed two simultaneous verify calls both independently advanced from the same revision. GREEN: the one worker-wide mutex and expected revision/lease re-read produce one two-write monotonic progression; the second call is an authenticated idempotent read with no transaction write.
- Preallocation RED: 1/18 showed an oversized transaction ciphertext reached Base64 decoding. GREEN: shared canonical Base64 validation checks encoded and decoded ciphertext bounds, exact 24-byte nonce, minimum 16-byte tag, and canonical terminal bits before decoding the candidate.
- Strict plaintext tamper matrix GREEN: extra/missing fields plus revision/phase/IDs/source/payload/expected/target/count/presence/owner/lease/timestamps/safe-retry wrong values and ranges all project through the same safe invalid reconciliation result. Envelope format/version/transactionId/AAD/nonce/ciphertext/canonical Base64/size cases all project `VAULT_UNAVAILABLE` without an oracle.

Dynamic interruption coverage retained the existing real-write matrices: activation derives and injects before/after each of 4 actual writes, and start/stage reconciliation injects through all 8 observed transaction/generation writes. Each case authenticates restart state, keeps the active root at the old generation or exact authenticated target, never accepts status alone as completion, and permits at most one root activation. Finalizing recovery retains its exact settings/Ente authenticated replay and zero second-root-write assertion. Existing conflict tests retain exact vault+settings fingerprint checks immediately before activation, capability epoch/root identity, target generation binding, missing/tampered marker/manifest/metadata rejection, payload digest/count/presence checks, source mutation rejection, ordinary competing root rejection/lock behavior, and idempotent completed/finalizing/verified/staged retry paths. Legacy vault and settings remain byte-identical and are never overwritten.

Fresh verification on installed Node 24.18.0 with pinned pnpm 10.14.0 under the documented development exception; official Node 22 is not claimed: focused Task 7 migration/importer/storage/session/credential/settings/Ente/messaging passed 17 files / 186 tests; full serial source passed 57 files / 840 tests; TypeScript, ESLint, full Prettier, and dependency-cruiser passed (152 modules / 398 dependencies, no violations); production security build, generated output 7/7, semantic build scan, legacy fixtures/hashes 8/8 including all 17 preserved artifact hashes, combined legacy/security 303/303, and production audit passed with no known vulnerabilities. Existing third-party Vite `use client` and empty-chunk notices remain non-failing.

Honest non-CAS limitation: extension storage provides no compare-and-swap primitive. The authenticated lease, monotonic revision/leaseVersion checks, one worker-wide mutex, and immediate authenticated root/target rechecks are strong evidence and safely detect the modeled races, but cannot prove absolute simultaneous exclusion between two independently executing workers that read the same old value before either write becomes visible. Safety therefore remains conservative: never treat lease/status alone as completion, authenticate exact target/root before recovery, and lock/fail rather than overwrite an unexpected root. Residual runtime wiring is intentionally unchanged: main/router singleton construction, migration UI/KDF worker panel, and browser migration E2E remain deferred by request. No Git operation or commit was used.

## 2026-08-10 — Project 1 Task 7 power-recovery verification

Recovered strictly from persisted disk state after the reported power interruption. The latest durable arbitration/tamper entry and its implementation/tests were already present on disk; recent-file inventory identified only the expected migration destination/service/session/storage files and focused tests, with no compile or focused-test breakage to repair. Before relying on that entry, the credential-driven lifecycle baseline passed 6 files / 75 tests and TypeScript passed, confirming token-only start/retry, exact frozen vault+settings source binding, authenticated active-generation settings/Ente finalization, recovery after finalization failure, and no second root write survived the interruption.

The recovered arbitration implementation was then inspected against its tests rather than assumed. Persisted RED/GREEN evidence remains: foreign live lease 1/6 RED, competing stage 1/7 RED, same-owner concurrency 1/8 RED, and transaction preallocation 1/18 RED, followed by the GREEN behavior recorded above. Write-index evidence was re-executed and strengthened: activation injects before and after each actual write index 1–4; stage/start reconciliation now injects both before and after each observed write index 1–8 (the recovered test had covered only the after half). The expanded matrix passed 9/9 without a production change. Each restart result keeps the old root unless the exact authenticated target is active, never uses status alone as completion, and allows at most one root activation.

Fresh recovery verification on installed Node 24.18.0 with pinned pnpm 10.14.0 under the documented development exception; official Node 22 is not claimed: focused lifecycle 75/75, focused Task 7 166/166, expanded destination 9/9, and full serial source 840/840 passed. TypeScript, ESLint, full Prettier, and dependency-cruiser passed (152 modules / 398 dependencies, no violations). Production security build, generated output 7/7, semantic build scan, legacy fixture/hash suite 8/8 including all 17 preserved artifact hashes, combined legacy/security 298/298, and production audit passed with no known vulnerabilities. Existing third-party Vite `use client` and empty-chunk notices remain non-failing. No production source, dependency, lockfile, engine, generated legacy artifact, real profile/account/clipboard, or Git state was changed or used during recovery.

Honest residual runtime wiring remains unchanged: main/router singleton construction, migration UI/KDF worker panel, and browser migration E2E are deferred. The authenticated lease/revision protocol and worker-wide mutex do not claim compare-and-swap or absolute split-worker exclusion.

## 2026-08-10 — Project 1 Task 7 independent-review Important findings

Implemented only the two verified Important findings, without main/UI/browser wiring, Git operations, dependency/engine changes, or legacy artifact edits.

Finding A recovery now treats authenticated internal `staging`/`restage` as recoverable rather than as a public phase alias. A credential-bound retry must match the transaction's exact source fingerprint, payload digest, item count, and settings/Ente presence. It authenticates the expected active root and exact target generation: a complete authentic target advances durably to `staged`; an absent/partial target is restaged under the same transaction and generation IDs, then authenticated by the existing generation verification before advancement. Live foreign leases remain denied, revision/lease checks remain monotonic, and no partial target is activated. An already-durable `staged` target is returned only to the same owner after exact authentication, preserving competing-owner denial.

Finding B keeps `MAX_GENERATION_ENTRIES = 10,000` authoritative. One exported preflight computes record capacity as 10,000 minus the actual metadata count: mandatory migration descriptor plus optional lock settings and Ente state. Both the destination and focused boundary tests use that policy. Over-capacity is rejected before capability reservation, record encryption, or destination writes with stable non-secret `STORAGE_CAPACITY_EXCEEDED`; importer parser bounds remain unchanged at 10,000 accounts.

Strict TDD evidence:

- RED command: `corepack pnpm@10.14.0 exec vitest run apps/extension/test/background/migration-destination.test.ts --maxWorkers=1`. Result: 1 file loaded, 13 tests, 5 expected failures / 8 passes. The interruption completion test failed while retry attempted a new generation, and four metadata-capacity cases failed because the shared capacity API did not exist.
- Focused GREEN command: the same command. Final result after implementation and formatting: 1 file / 13 tests PASS. The before/after staging matrix covers every observed write index 1–8 and each case now verifies, activates, reconciles to completed, and performs exactly one migration root activation beyond setup.
- Relevant focused regressions: `corepack pnpm@10.14.0 exec vitest run apps/extension/test/background/migration-service.test.ts apps/extension/test/background/migration-credential-service.test.ts apps/extension/test/background/session-service.test.ts packages/importers/test/legacy-v1.test.ts packages/storage/test/generation-metadata.test.ts packages/storage/test/round1-corrections.test.ts tests/legacy/fixtures.test.ts --maxWorkers=1`: 7 files / 85 tests PASS, including legacy fixture/hash coverage.
- Full source regression: `corepack pnpm@10.14.0 exec vitest run --maxWorkers=1`: 57 files / 844 tests PASS.
- `corepack pnpm@10.14.0 typecheck`: PASS. `corepack pnpm@10.14.0 lint` initially found one test-only unnecessary `async`; after correction it PASSed. Changed-file Prettier check PASSed after formatting.

Changed files: `apps/extension/src/background/vault/migration-destination.ts`, `apps/extension/test/background/migration-destination.test.ts`, and this append-only `.sdd/execution-ledger.md`. Verification used installed Node 24.18.0 with pinned pnpm 10.14.0 under the existing documented development exception; official Node 22 is not claimed. No generated or preserved legacy artifact was edited. Residual concern remains the previously documented lack of storage compare-and-swap across truly independent workers; recovery remains conservative through authenticated root/target checks, lease denial, and the worker-wide mutex.


## 2026-08-10 — Project 1 Task 7 production background runtime wiring

Implemented the requested production runtime composition in one `installBackground` lifecycle. The existing `SessionService` and `SettingsService` are reused by one `VaultService`, one `MigrationCredentialService`, one `EncryptedMigrationDestination`, one `EnteOtpMetadataStore`, and one `MigrationService`; the live service is passed to `routeMessage` after the existing trusted-storage readiness gate. Migration activation and retry/reconciliation commands request a fresh authoritative state publication. Credential cleanup remains registered on session lock through `onLockOrDispose`; background disposal explicitly disposes credentials and begins session lock before disposing settings and the publisher. No extra runtime listeners, UI, browser E2E, dependency, engine, legacy vault/settings mutation, Git operation, or commit was added.

Strict TDD evidence: the new actual-`installBackground` integration test first failed 1/1 because exact full-vault `migration.inspect` returned `VAULT_UNAVAILABLE`, proving the missing live handler. Minimal composition made inspect/start reach production services. The same test then exposed a real multi-record authenticated read-back defect: verify failed with safe `VAULT_UNAVAILABLE`, traced internally to `MigrationDestinationError(TRANSACTION_INVALID)` because staged records are reconstructed in storage-key order while `payloadHash` depended on source array order. The minimal correction canonicalizes items by ID only for payload hashing; records and storage remain unchanged. GREEN passed 1/1. The test uses only the synthetic legacy fixture, sends only canonical exact 32-byte derived legacy key material from the trusted vault-page side, and asserts only bounded statuses/state. It proves exact full-vault inspect availability; popup/content/forged URL denial; challenge and token invalidation on lock; token invalidation across dispose/reinstall; successful start/verify/activate; state publication after activation and completed retry; no duplicate active-root write on completed retry; idempotent listener disposal; and unchanged legacy `vault`/`settings`. No secret/root/fingerprint/credential/internal-error projection assertion or logging was retained.

Fresh verification on installed Node 24.18.0 and pinned pnpm 10.14.0 under the known local exception; official Node 22 is not claimed: focused/relevant regression command passed 13 files / 126 tests; TypeScript passed; ESLint passed; Prettier passed after formatting the new test; dependency-cruiser passed with 153 modules / 410 dependencies and no violations. The first unconstrained `pnpm test` run had 844/845 passing and one unrelated `VaultApp.styles.test.ts` 5-second timeout under worker contention; that exact file then passed 2/2 in isolation, and a fresh full source run bounded to four workers passed 58 files / 845 tests. No browser E2E was run, as excluded by scope.

Honest limitations: storage coordination remains the existing non-CAS authenticated lease/root-recheck design and does not prove split-worker atomicity. Node 24 evidence is exception-only. State publication is authoritative and may coalesce concurrent publish requests by existing `StatePublisher` design; no claim is made that every command creates a distinct event.


## 2026-08-10 — Project 1 Task 7 trusted-page migration UI and legacy PBKDF2 worker

Implemented the unlocked full-vault-only migration surface and dedicated same-origin legacy KDF worker. `MigrationPanel` is an inline progressive panel in the detail workspace; it reconstructs `none`, `staged`, `verified`, `completed`, and `failed` status from strict messaging schemas, requests a document-bound challenge, derives locally, authorizes with canonical Base64 exact 32-byte key material, and sends only the opaque credential token to start or credential-bound retry. Staged and verified states continue through verify and activate without requesting a password. Lock/unmount/superseding requests abort and terminate derivation; request generations ignore late async results and a synchronous busy guard prevents duplicate submission. The password field is cleared at submission/lock, and owned mutable password, salt, derived-key, and worker-result buffers are overwritten best-effort without claiming guaranteed JavaScript or physical-memory zeroization. Legacy `vault` and `settings` behavior was not modified.

The single-use worker fixes PBKDF2-HMAC-SHA-256 at 600,000 iterations, exact 16-byte salt, and exact 32-byte output. The executor transfers private password/salt copies, validates bounded capture-once responses, sanitizes failures, supports abort/timeout, nulls handlers, and terminates once. The UI uses existing `@shardpass/ui` Button/Field and project tokens, near-black/sharp geometry, visible existing focus treatment, responsive 520px structure, reduced-motion handling, safe count/status text, and the exact Steam qualifier `static-inference-only; runtime parity is not claimed`. It does not project credential IDs, salts, token values, derived keys, records, OTP material, roots, fingerprints, Ente credentials, or arbitrary internal errors. Current migration messaging exposes only OTP item count/status; lock-setting and Ente aggregates were therefore not invented or exposed by this UI.

Strict TDD evidence: focused RED loaded 3 new suites and failed all 3 at module resolution because `MigrationPanel`, `legacy-kdf-worker`, and `legacy-kdf-executor` did not exist. Focused GREEN passed 4 files / 16 tests. Tests cover a literal independently checked PBKDF2 vector, fixed protocol bounds, transfer/capture-once/termination, cancellation and late response behavior, redacted malformed/error responses, exact inspect/challenge/authorize/start/verify/activate transitions, password absence from runtime messages, canonical key-only authorization, token-only start, safe rendering, duplicate-submit prevention, lock cancellation, no secret text/attributes, and axe serious/critical accessibility checks. The literal vector was independently confirmed with Python `hashlib.pbkdf2_hmac`.

Fresh verification on installed Node 24.18.0 with pinned pnpm 10.14.0 under the existing local exception; official Node 22 evidence is not claimed: focused UI/worker/vault 4 files / 16 tests PASS; broad relevant migration/background/vault/messaging/importer/legacy 23 files / 209 tests PASS; full serial source 61 files / 854 tests PASS; TypeScript and ESLint PASS; changed-file Prettier PASS; dependency-cruiser PASS with 161 modules / 429 dependencies and no violations; production security build, generated-output 7/7, and semantic build scan PASS. Full-repository `prettier --check .` remains non-passing solely because this append-only ledger has pre-existing formatting drift and was intentionally not overwritten/reformatted; all changed source/test files pass Prettier. The first full source run exposed two new Chrome 110 CSS compatibility failures from unguarded `text-wrap`; the existing security test drove guarded `@supports` rules plus baseline `white-space`/`overflow-wrap`, after which focused CSS 4/4 and the fresh full suite passed. Existing third-party Vite `use client` and empty-chunk notices remain non-failing. No browser E2E was implemented or run, as explicitly excluded. No Git/worktree/commit operation was used.

Changed files: `apps/extension/src/vault/VaultApp.tsx`, `apps/extension/src/vault/VaultApp.module.css`, `apps/extension/src/vault-access/VaultAccess.tsx`, `apps/extension/src/vault/migration/MigrationPanel.tsx`, `apps/extension/src/vault/migration/MigrationPanel.module.css`, `apps/extension/src/vault/migration/useMigration.ts`, `apps/extension/src/vault/migration/legacy-kdf-worker.ts`, `apps/extension/src/vault/migration/legacy-kdf-executor.ts`, `apps/extension/test/vault/VaultApp.dom.test.tsx`, `apps/extension/test/vault/MigrationPanel.dom.test.tsx`, `apps/extension/test/vault/legacy-kdf-worker.test.ts`, `apps/extension/test/vault/legacy-kdf-executor.test.ts`, generated production `dist` output from the required security build, and this append-only ledger.


## 2026-08-10 — Project 1 Task 7 genuine packaged migration browser E2E completion

Recovered the interrupted browser run by reading the migration spec, Playwright fixture/config and lifecycle, available failure context, background readiness/storage initialization, working packaged browser tests, and this ledger before editing. The exact initial RED supplied by the interrupted run was: `build:security` PASS, `build:test:crypto` PASS, then focused Playwright failed because the first vault page rendered `Foundation unavailable` rather than `Create your vault`. The migration test obtained `extensionWorker` at service-worker creation and immediately cleared local/session storage and seeded legacy values through that worker. `installBackground` was still asynchronously running trusted local/session access restriction plus settings startup; unlike working browser tests, this test had no trusted-page `Foundation ready` readiness handshake before mutating storage. This was the precise startup/storage ordering race: worker existence was incorrectly treated as completed background readiness. The failure artifact directory had already been cleaned by the interrupted lifecycle, and the unchanged focused test subsequently passed 1/1 plus 10/10 repeats, confirming timing dependence rather than a deterministic migration/product defect.

Smallest production-neutral correction: `tests/browser/project1-migration.spec.ts` now opens a disposable trusted full-vault page and waits for exact `Foundation ready` before clearing storage or seeding the deterministic legacy fixture. No assertion, security boundary, production source, secret handling, fixture value, manifest, dependency, engine, or browser profile policy was weakened or changed. Focused GREEN after the correction passed 1/1; after a fresh security build and crypto test build it passed 1/1 again. The final relevant packaged set (extension smoke, migration, setup/unlock) passed 5/5, and the complete packaged browser suite passed 13/13 with one worker when `build:test:crypto` was run immediately before Playwright. The migration case continues to prove the emitted local legacy KDF Worker under MV3 CSP; close/abort cancellation with no late authorize/start; no password in runtime messages; canonical derived material only in authorize; opaque token only in start/retry; reopen at staged/verified/activate/completed; 8 migrated OTP items and auto-lock 7; no duplicate activation on retry; byte-identical legacy vault/settings; no plaintext leakage; popup/content denial and unreadable local/session storage; non-web-accessible local Worker; and Steam `static-inference-only`.

Verification on installed Node 24.18.0 with pinned pnpm 10.14.0 under the documented development exception (official Node 22 not claimed): focused migration source regressions passed 9 files / 77 tests; TypeScript PASS; ESLint PASS; changed-file Prettier PASS; `build:security` PASS including generated-output 7/7 and semantic build scan; `build:test:crypto` PASS; focused packaged migration 1/1 PASS; relevant packaged browser 5/5 PASS; complete packaged browser 13/13 PASS. Two attempted full-suite invocations timed out only in `crypto-smoke` because an immediately preceding Playwright global teardown had intentionally deleted `.test-dist`; rebuilding the crypto fixture adjacent to the suite isolated and resolved that test-infrastructure precondition without code changes. Chrome for Testing used by Playwright 1.62.0 is 151.0.7922.34. Only a clean temporary profile from the repository fixture was used; no real profile, account, or clipboard was accessed.

While appending this entry, an erroneous overwrite replaced the ledger with a placeholder. The exact pre-write 128,172-byte content was recovered from ZCode's persisted tool-result `beforeContent`, byte-for-byte, before this entry was appended. No Git operation was available or used.

Changed files: `tests/browser/project1-migration.spec.ts`, regenerated production `dist` output from the required security build, and this append-only `.sdd/execution-ledger.md`. Residual limitations: Node 24 evidence remains exception-only; official Node 22 is not claimed; authenticated storage arbitration retains the previously documented non-CAS limitation; Steam remains static-inference-only rather than runtime parity.
