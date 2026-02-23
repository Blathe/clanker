# PRD: Clanker — Single‑User, GitHub‑Native, Security‑First Autonomous Agent

**Status:** v1.1 (markdown export)  
**Scope:** 1 repo = 1 bot (no multi‑tenant, not exposed publicly)  
**Runtime:** GitHub Actions (GitHub‑hosted runners)  
**Primary UI:** Discord free‑form chat (v0), Web control panel (v1)

---

## 1) Summary

**Clanker** is an autonomous AI assistant (a caffeinated raccoon persona) whose **canonical state, audit trail, and change history live in a GitHub repository**. Users communicate in **free‑form natural language**. Clanker converts messages into **structured packets**, runs them through **policy gates** (risk scoring, approvals, tool allowlists, network rules), executes approved actions inside **GitHub Actions**, and proposes behavior‑changing modifications via **PRs**. Merges trigger **automatic build + deploy**.

Key pillars:
- **Auditability:** job files + append‑only audit logs + evidence manifests
- **Security:** policy‑gated tool execution, least privilege, deny‑all egress by default
- **Safe autonomy:** “learn/propose” via intel + PRs; never silently change behavior
- **Extensibility:** skills folder (markdown runbooks) + JSON policies

---

## 2) Goals and non‑goals

### Goals
1. **Auditable by default:** every job is explainable (what/why/who/evidence).
2. **Secure execution:** free‑form chat never directly triggers tools; only validated packets do.
3. **GitHub as control plane:** policies, skills, schedules, jobs, logs, PRs, deploys are traceable in GitHub.
4. **Safe self‑modification:** Clanker opens PRs against itself automatically; risky changes require approval.
5. **Scheduled autonomy:** recurring jobs (daily/weekly) can gather intel, audit sites, propose improvements.
6. **Two‑model strategy:** lightweight model for routing; strongest configured model for code authoring.

### Non‑goals (v0/v1)
- Multi‑tenant use, shared bots, “expose my bot to others”
- Public API that others can call
- Unbounded internet access by default
- Silent self‑modification outside PRs

---

## 3) Personas

- **Operator (you):** owns repo, configures policies/modes, approves risky PRs.
- **Auditor (future you):** verifies why a change happened using only GitHub artifacts.
- **Clients (interfaces):** Discord relay (v0), Web control panel (v1).

---

## 4) Core concepts

### 4.1 Repo = Bot
Clanker is cloned into a new repo to create a new bot instance. The repo contains:
- agent runtime code
- skills + policies
- job records + audit logs
- scheduled job definitions
- deployment workflows

### 4.2 Packets (structured “wire format”)
All action‑relevant LLM output becomes **typed packets** and must validate before execution.

Minimum packet set:
- `UserMessagePacket` (raw request + metadata)
- `JobSpecPacket` (intent/scope/constraints)
- `PlanPacket` (steps + required evidence)
- `ToolCallPacket` (tool + args + expected outputs)
- `ToolResultPacket` (stdout/stderr/exit/artifacts)
- `PolicyDecisionPacket` (allow/deny, risk, approvals required)
- `ChangeProposalPacket` (files touched, PR summary, risk delta)

**Invariant:** executor only runs **validated ToolCallPackets** that pass policy.

### 4.3 Two‑model strategy
- **Lightweight model:** chat, intent extraction, job routing, planning, risk classification, packet drafting
- **Strongest selected model:** any code/patch/diff authoring, PR content, “final authoring”

---

## 5) Repository structure (recommended)

```text
/agent/                  # runtime, packet validation, policy engine, tool executor
/policies/               # JSON rules, allowlists, risk scoring config
/skills/                 # markdown runbooks (optional frontmatter schema)
/jobs/YYYY/MM/           # job markdown summaries (human-readable)
/audit/                  # append-only JSONL event logs + evidence manifests
/cron/jobs.json          # mutable scheduled job definitions (source of truth)
/intel/YYYY-MM/          # threat intel + audit reports (informational PRs)
/memory/                 # preferences + summaries (separate from policies)
/.github/workflows/      # intake, execute, cron-dispatcher, deploy, tests
```

---

## 6) Execution model & security posture

### 6.1 GitHub Actions runner constraints
- **GitHub‑hosted runners** (ephemeral machines)
- **Best-effort deny-by-design network posture** is implemented by workflow design:
  - untrusted analysis runs inside Docker with `--network none`
  - network access only happens via a **controlled broker** step (see §6.4)

### 6.2 Least‑privilege token & permissions
- Workflow `permissions:` must be minimal.
- Scanning/testing runs with read-only permissions where possible.
- PR-writing occurs in a separate step/job with scoped permissions and only after policy approval.
- Step-level secret exposure matrix:
  - **Untrusted analysis step:** no secrets ever.
  - **Broker/network step:** only the minimal secrets required for that fetch pattern.
  - **PR-writing step:** only scoped repo write token/permissions needed to open or update PRs.
  - **Deploy step:** environment-protected secrets and optional environment approval gates.

### 6.3 Change control
- **All job-driven repository writes are PR-based in v0** (no direct commits from job workflows).
- **One PR per job** (a single PR may include multiple file edits across `/jobs`, `/audit`, `/intel`, code, and config).
- Behavior-changing modifications remain high risk:
  - `/agent/**`, `/.github/**`, `/policies/**` = always high risk, owner approval required

### 6.4 Network “airlock” pattern (recommended)
Because GitHub‑hosted runners have outbound internet by default, Clanker applies a best-effort airlock pattern with:

1. **Broker fetch step (trusted, policy‑controlled)**
   - Only this step may do outbound HTTP
   - Enforces allowlisted domains per skill/policy
   - Logs requests and hashes responses

2. **Analysis step (untrusted) with no network**
   - Runs in Docker `--network none`
   - Receives brokered content via files/artifacts
   - No secrets; minimal permissions

---

## 7) Functional requirements

### 7.1 Job creation & lifecycle
**Canonical unit:** Job.

On request:
1. Create job record + initial packets
2. Append audit events (JSONL)
3. Policy gate → risk + approvals required
4. Execute if allowed
5. If repository changes are needed → open or update the job PR with evidence + summary
6. Merge triggers deploy

State machine (minimum):
- `RECEIVED` → `PARSED` → `POLICY_CHECKED` → `PLANNED` → `EXECUTING`
- If denied: `DENIED` (terminal, with reason + evidence pointers)
- If no repository changes are needed: `DONE`
- If repository changes are needed: `PR_OPENED` → `WAITING_APPROVAL` → `MERGED` → `DEPLOYED` → `DONE`
- Additional terminal states: `FAILED`, `CANCELLED`, `TIMED_OUT` (all require reason + evidence pointers)

### 7.2 Policy engine (JSON rulesets)
Policy evaluates:
- tool allowlist/denylist
- path allow/deny (esp. self-mod)
- network egress allowlist (per skill/job)
- secrets access (default deny)
- risk score + category
- required approvals (`none` or `owner`)

Approval authority (v0):
- Risky jobs/PRs are approved only by the bot owner in the GitHub UI.

### 7.3 Risk categories (enforced)
- **R0 Read-only:** summarize, inspect, list, read logs
- **R1 Low-risk writes:** write `/jobs`, `/audit`, `/intel`, `/memory` (informational)
- **R2 Config changes:** `/skills`, `/cron` (behavior-adjacent)
- **R3 High-risk system changes:** `/agent`, `/policies`, `/.github/workflows` (behavior-changing)

### 7.4 Merge safety modes (operator-configurable)
- **Strict:** no auto-merge; everything requires explicit owner approval (including log/intel-only changes)
- **Whitelist Folders:** auto-merge only if touched paths ⊆ allowlist (e.g., `/intel/**`, `/memory/**`)
- **YOLO:** auto-merge any job PR if required checks pass, including R3

> YOLO is intentionally high risk and should be presented with explicit warnings and a global kill switch.

### 7.5 PR strategy (enforced in v0)
- One PR per job.
- A job PR may include multiple edits (for example `/jobs/**`, `/audit/**`, `/intel/**`, plus code/config updates).
- No direct commits from automated job execution.
- Merge behavior is controlled only by the selected mode in §7.4.

### 7.6 Skills (markdown runbooks)
Skills are deterministic procedures Clanker must consult before “general reasoning” or web browsing.

Skill file requirements:
- name + triggers
- preconditions
- allowed tools
- allowed network domains (if any)
- step list with evidence requirements
- failure modes + rollback guidance

**Rule:** before extended thinking or web search, Clanker checks `/skills` for a matching runbook.

### 7.7 Tool execution model
Tools execute only via approved `ToolCallPacket`.

Requirements:
- allowlisted tool binaries only
- working directory constraints
- secrets redaction
- concurrency + rate limits (avoid PR storms)

**Untrusted code execution pattern (important):**
- **Untrusted phase:** scans/tests run in Docker `--network none`, no secrets
- **Trusted phase:** PR-writing uses minimal write permissions, only after policy approval

### 7.8 Interfaces

#### v0: Discord relay
- free-form chat → creates async Job in repo
- immediate acknowledgement pattern: "Job accepted. Running now. I'll report back with links."
- completion/failure notifications include links to job files/PRs/actions

#### v1: Web control panel
Capabilities:
- view jobs + audits
- edit policies/modes
- edit skills
- create/edit cron jobs
- approve/deny risky jobs/PRs

Auth (recommended):
- GitHub OAuth or user-supplied fine-grained PAT (keeps attack surface smaller than inventing a new public API)

---

## 8) Scheduling (“cron”) design

### 8.1 Canonical schedule format: cron-only (for now)

Store schedules **only** as standard 5-field POSIX cron strings (minute hour day-of-month month day-of-week), plus a required `timezone` field.

Storage:
- Canonical schedule registry is `cron/jobs.json` (mutable).
- `schedule_cron` + `timezone` are source-of-truth fields for each schedule entry.
- Schedule edits overwrite prior values in `cron/jobs.json`; audit events record the change history.

Why:
- Cron is a familiar standard and an easy “escape hatch” for any schedule shape.
- It matches GitHub Actions `on.schedule` syntax (which is cron-based and interpreted in UTC).  

> Note: GitHub Actions cron schedules are interpreted at specific **UTC** times, run on the latest commit on the **default branch**, and cannot run more frequently than **every 5 minutes**. This is why Clanker uses a dispatcher tick rather than depending on GitHub for exact per-job timing.

### 8.2 `cron_summary`: derived, **very verbose** human-readable schedule text

Add a `cron_summary` field that is **computed** by Clanker (dispatcher/control panel) from:
- `timezone`
- `schedule_cron`

Rules:
- `schedule_cron` is the **source of truth**.
- `cron_summary` is **derived** (never used for execution).
- Each dispatcher run should record the computed summary + the next few run timestamps in the audit log for point-in-time clarity.

#### 8.2.1 Output style requirements (verbose)

- Always render times in **12-hour format with AM/PM** (e.g., `5:00 PM`).
- Always include the **IANA timezone** at the end (e.g., `America/Los_Angeles`).
- Prefer a single sentence ending with a period.
- When cron semantics may surprise a human, add an optional `cron_notes` field (see below) and/or append a second line beginning with `Note:`.

#### 8.2.2 Canonical examples

Assume `timezone = America/Los_Angeles`:

- `0 17 * * *` → **“Every day at 5:00 PM America/Los_Angeles.”**
- `0 * * * *` → **“Every hour at 12:00 AM, 1:00 AM, 2:00 AM, … America/Los_Angeles.”**  
  *(UI may shorten the middle with an ellipsis; the intent is “on the hour, every hour.”)*
- `5 * * * *` → **“Every hour at 12:05 AM, 1:05 AM, 2:05 AM, … America/Los_Angeles.”**
- `*/15 * * * *` → **“Every 15 minutes America/Los_Angeles.”**
- `0 */2 * * *` → **“Every 2 hours at 12:00 AM, 2:00 AM, 4:00 AM, … America/Los_Angeles.”**
- `0 9 * * 1-5` → **“Every weekday (Monday–Friday) at 9:00 AM America/Los_Angeles.”**
- `0 9 * * 0,6` → **“Every weekend (Saturday and Sunday) at 9:00 AM America/Los_Angeles.”**
- `0 1 */2 * *` → **“Every 2 days at 1:00 AM America/Los_Angeles.”**  
  `cron_notes`: **“Day-of-month ‘*/2’ resets each month; this is not anchored to a specific start date.”**
- `0 1 1 * *` → **“Every month on the 1st at 1:00 AM America/Los_Angeles.”**
- `0 1 1 1 *` → **“Every year on January 1st at 1:00 AM America/Los_Angeles.”**

#### 8.2.3 Fallback format (for complex schedules)

If Clanker cannot confidently translate a cron pattern into one of the common shapes, it should produce a verbose but accurate fallback:

> “At minute `<MIN>` past hour `<HOUR>` on day-of-month `<DOM>` in months `<MON>` and days-of-week `<DOW>`, <TIMEZONE>.”

And set `cron_notes` to clarify any semantics that matter.

#### 8.2.4 Day-of-month vs day-of-week semantics

Cron implementations commonly treat **day-of-month** and **day-of-week** as an **OR** when both are restricted (i.e., the job runs when either matches). If Clanker adopts OR semantics (recommended for compatibility), it must:
- include a `cron_notes` value stating: **“Day-of-month and day-of-week are combined using OR semantics.”**
- and the UI should display the note prominently.


### 8.3 Scheduling approach on GitHub Actions: dispatcher

Because GitHub’s scheduler is cron/UTC-based and not guaranteed to run exactly on the minute, Clanker uses:

- A **single** scheduled workflow (e.g., every 10 minutes) to run the dispatcher.
- The dispatcher reads `cron/jobs.json`, computes what is due in each job’s `timezone`, then **enqueues** due jobs by creating JobSpecs.
- Each due execution uses deterministic dedupe key:
  - `run_instance_id = <job_id>:<scheduled_at_utc>`
- Before enqueue, dispatcher checks whether that `run_instance_id` already exists; if yes, skip.
- Dispatcher workflow uses a concurrency group to prevent overlapping dispatcher runs.

This makes schedules resilient to drift/delay and gives Clanker control over local-time semantics (including daylight saving time) via `timezone`.

### 8.4 Example: daily at 5 PM PT, self-review + intel

Cron entry:
- `schedule_cron`: `0 17 * * *`
- `timezone`: `America/Los_Angeles`

Dispatcher enqueues a `SELF_REVIEW_INTEL` job that:
1. summarizes new jobs since last review
2. generates improvements and writes an **intel report** PR to `/intel/**` (low risk)
3. optionally opens separate proposal PRs to `/skills/**` or `/policies/**` (manual approval)

## 9) Safe self‑improvement (“learn” without silent risk)

Split self-improvement into three streams:

1. **Intel (informational, low-risk):** `/intel/YYYY-MM/*.md`  
   - daily web security notes, LLM threat summaries, website diffs
   - can be auto-merged in Whitelist mode

2. **Preferences memory (low-risk):** `/memory/PREFERENCES.md`  
   - modes, allowlists, operator preferences, non-sensitive summaries

3. **Behavior changes (high-risk):**  
   - updates to `/policies/**`, `/skills/**`, `/agent/**`
   - always PR-based, risk-rated, requires approval (esp. R3)

---

## 10) Key workflows (end-to-end)

### 10.1 “Scan repo and fix first vulnerability”
1. User → job created
2. Lightweight model → JobSpec + Plan
3. Policy assigns risk
4. Untrusted phase runs scanners/tests in `--network none`
5. Strong model authors minimal patch + PR description + evidence links
6. PR opened; approval required if risk demands
7. Merge → deploy workflow runs

### 10.2 “Audit a website daily”
1. Cron dispatcher enqueues website audit job
2. Skill specifies allowed domain(s) and broker fetch procedure
3. Snapshot + hashes saved; diffed against previous day
4. PR adds report under `/intel/` (low risk)
5. If concerning, open separate high-risk proposal PR to update policies/skills

---

## 11) Non-functional requirements

### Security
- least privilege workflow permissions
- secrets never available to untrusted steps; redact logs
- branch protections + CODEOWNERS for R3 paths
- risky-path approvals restricted to the bot owner (v0: GitHub UI approval flow)
- avoid unsafe CI trigger patterns that elevate untrusted code

### Auditability
Each job produces:
- job markdown summary
- audit JSONL event trail
- evidence manifest (hashes + artifact pointers)
- PR + workflow run links

### Reliability
- idempotent execution
- bounded retries
- concurrency controls (avoid PR storms)
- deterministic dispatcher dedupe (`run_instance_id`) for scheduled jobs

---

## 12) Success metrics
- % jobs with complete evidence bundle (>95%)
- mean time from request → PR created
- number of silent behavior changes (target: 0)
- scheduled job success rate

---

## 13) Release plan

### v0 (Discord + GitHub only)
- packet schema + validator
- policy JSON engine + risk classifier
- executor workflow with untrusted/trusted split
- PR generation + deploy-on-merge
- cron dispatcher + `cron/jobs.json` + dedupe keys
- skills folder lookup + deterministic runbooks

### v1 (Web control panel)
- GitHub-auth UI (policies/skills/cron/jobs/audit viewer)
- approval UX (approve/deny)
- mode switch (Strict / Whitelist / YOLO)
- dashboards (job history, risk stats, intel feed)

---

## 14) Starter schemas (examples)

### 14.1 `cron/jobs.json` — cron-only + derived summary (verbose)

```json
{
  "version": 1,
  "updated_at": "2026-02-23T20:10:00Z",
  "jobs": [
    {
      "job_id": "cron_daily_intel",
      "enabled": true,
      "timezone": "America/Los_Angeles",
      "schedule_cron": "0 17 * * *",
      "cron_summary": "Every day at 5:00 PM America/Los_Angeles.",
      "cron_notes": null,
      "next_runs_utc": [
        "2026-02-24T01:00:00Z",
        "2026-02-25T01:00:00Z",
        "2026-02-26T01:00:00Z"
      ],
      "next_runs_local": [
        "2026-02-23 5:00 PM America/Los_Angeles",
        "2026-02-24 5:00 PM America/Los_Angeles",
        "2026-02-25 5:00 PM America/Los_Angeles"
      ],
      "job_spec": {
        "intent": "SELF_REVIEW_INTEL",
        "inputs": { "since": "last_run" },
        "constraints": {
          "allowed_domains": ["github.com"],
          "max_prs": 2
        }
      },
      "last_run": { "at": "2026-02-22T01:00:00Z", "status": "DONE" }
    }
  ]
}
```

Notes:
- `schedule_cron` is the **only** scheduling source of truth.
- `cron_summary`, `cron_notes`, and `next_runs_*` are **derived** for UX/audits and should be recomputed when the cron or timezone changes.
- The dispatcher should also write the computed `cron_summary` + `cron_notes` + `next_runs_*` into the job’s audit trail each run for point-in-time clarity.
- Each due run instance should derive `run_instance_id = <job_id>:<scheduled_at_utc>` and dedupe on that key.
- UIs may truncate long hourly summaries with an ellipsis (e.g., “12:00 AM, 1:00 AM, …”) while keeping the full string available on hover/details.


### 14.2 `JobSpecPacket` (simplified)
```json
{
  "job_id": "job_2026_02_23_001",
  "intent": "REPO_VULN_FIX_FIRST",
  "repo": "owner/repo",
  "constraints": {
    "allowed_tools": ["git", "rg", "npm", "node", "bash"],
    "allowed_domains": ["github.com"],
    "max_files_changed": 25
  },
  "outputs": {
    "pr_required": true,
    "evidence_required": ["scan_report", "tests_passed"]
  }
}
```

### 14.3 `PolicyDecisionPacket` (simplified)
```json
{
  "job_id": "job_2026_02_23_001",
  "risk_level": "R3",
  "allowed": false,
  "requires_approval": true,
  "reasons": [
    "Touches /.github/workflows (R3)",
    "Requests write permissions to contents"
  ],
  "recommended_changes": [
    "Split into untrusted scan job (read-only) + trusted PR job (write)"
  ]
}
```

---

## 15) Implementation backlog (execution plan)

Use this section as the build sequence. Each ticket should be completed with TDD (tests first, failing red state, then implementation).

### Epic A — Packet + job core

- **A1:** Add packet types + schemas (`src/packets/types.ts`, `src/packets/schema.ts`)
  - Tests: `tests/unit/packets/schema.test.ts`
- **A2:** Add job lifecycle state machine (`src/jobs/stateMachine.ts`)
  - Tests: `tests/unit/jobs/state-machine.test.ts`
- **A3:** Add job orchestration service (`src/jobs/service.ts`)
  - Tests: `tests/unit/jobs/service.test.ts`

### Epic B — Job policy (risk, approvals, modes)

- **B1:** Extend policy decisions with risk levels and owner-approval semantics (`src/jobPolicy.ts`)
  - Tests: `tests/unit/policy/risk-evaluate.test.ts`
- **B2:** Implement merge mode enforcement (Strict / Whitelist / YOLO) (`src/mergeModes.ts`)
  - Tests: `tests/unit/policy/merge-modes.test.ts`

### Epic C — Git-native persistence + audit

- **C1:** Add mutable cron registry repository for `cron/jobs.json` (`src/scheduler/cronRepository.ts`)
  - Tests: `tests/unit/scheduler/cron-repository.test.ts`
- **C2:** Add job/audit persistence services (`src/jobs/repository.ts`, `src/jobs/auditWriter.ts`)
  - Tests: `tests/unit/jobs/repository.test.ts`, `tests/unit/jobs/audit-writer.test.ts`

### Epic D — Dispatcher + idempotency

- **D1:** Implement due-run computation with timezone handling (`src/scheduler/dispatcher.ts`)
  - Tests: `tests/unit/scheduler/dispatcher-due.test.ts`
- **D2:** Enforce deterministic dedupe key `run_instance_id=<job_id>:<scheduled_at_utc>`
  - Tests: `tests/unit/scheduler/dispatcher-dedupe.test.ts`

### Epic E — GitHub adapter + PR orchestration

- **E1:** Build GitHub API adapter (`src/github/adapter.ts`)
  - Tests: `tests/unit/github/adapter.test.ts`
- **E2:** Build one-PR-per-job coordinator (`src/github/prOrchestrator.ts`)
  - Tests: `tests/unit/github/pr-orchestrator.test.ts`

### Epic F — Runtime cutover (Discord/REPL async job UX)

- **F1:** Refactor runtime to submit async jobs and post status updates (`src/main.ts`, `src/turnHandlers.ts`)
  - Tests: `tests/unit/main/job-submit-flow.test.ts`
- **F2:** Remove direct host command path from steady-state chat flow (keep temporary flag only during migration)
  - Tests: `tests/unit/turnHandlers/legacy-path-disabled.test.ts`

### Epic G — Security hardening + workflows

- **G1:** Enforce step-level secret exposure matrix (`src/github/workflowPolicy.ts`)
  - Tests: `tests/unit/security/secrets-exposure.test.ts`
- **G2:** Add workflows (`.github/workflows/intake.yml`, `.github/workflows/dispatcher.yml`, `.github/workflows/deploy.yml`)
  - Tests: `tests/unit/github/workflow-config.test.ts`

### Epic H — Decommission + cleanup

- **H1:** Remove obsolete runtime paths and update docs/prompts to GitHub-native operation
  - Tests: update existing tests and add regressions where needed

### Build order

1. Epic A
2. Epic B
3. Epic C
4. Epic D
5. Epic E
6. Epic F
7. Epic G
8. Epic H

### Definition of done (per ticket)

1. Tests written first and initially failing
2. Implementation passes new and existing tests
3. `npm test` passes
4. `npx tsc --noEmit` passes
5. Security implications documented in ticket/PR notes

### Working model recommendation

- **PRD** remains source of truth for architecture, invariants, and policy semantics.
- **GitHub Issues/Projects** track execution status of A1…H1 tickets.
- **GitHub Actions** execute CI/CD and scheduled dispatcher workflows; they should not be the task tracker.
