# Delegation Refactor Status

## What Is Implemented

### 1) Delegation lifecycle state machine
- File: `src/delegation/stateMachine.ts`
- Canonical states:
  - `queued`
  - `running`
  - `proposal_ready`
  - `no_changes`
  - `failed`
  - `accepted`
  - `rejected`
  - `expired`
- Transition guards reject invalid moves and proposal-id mismatches.

### 2) Delegation orchestration service
- File: `src/delegation/service.ts`
- Centralizes delegation-review orchestration previously embedded in `main.ts`:
  - Working directory validation
  - Worktree delegation execution
  - Proposal storage
  - Cleanup on persistence failure
  - Stale proposal expiration cleanup
- Emits run-level transition events with correlation IDs (`runId`).

### 3) Proposal repository abstraction
- File: `src/delegation/repository.ts`
- Repository interface with two adapters:
  - `InMemoryProposalRepository`
  - `FileProposalRepository`
- `FileProposalRepository` persists proposal records to:
  - `sessions/proposals.json`

### 4) ProposalStore now uses repository + state machine
- File: `src/delegation/proposals.ts`
- `ProposalStore` is now a lifecycle coordinator over repository records.
- Accept/reject/expire transitions are state-validated.

### 5) Runtime wiring updates
- File: `src/main.ts`
- Main now delegates proposal orchestration to `DelegationService`.
- Proposal persistence uses file-backed repository by default.
- Stale proposal expiration is invoked through `DelegationService`.

### 6) Observability improvements
- File: `src/logger.ts`
- Added `logDelegationRunState(...)` for structured run-level telemetry.
- Service transition callbacks in main log:
  - `started`
  - `proposal_ready`
  - `no_changes`
  - `completed`
  - `failed`

## Test Coverage Added

- `tests/unit/delegation/state-machine.test.ts`
- `tests/unit/delegation/service.test.ts`
- `tests/unit/delegation/repository.test.ts`
- Expanded assertions in:
  - `tests/unit/delegation/proposals.test.ts`

## Remaining Refactor Opportunities

1. Move proposal apply/reject command handling orchestration into a dedicated approval service.
2. Introduce file-locking/atomic write hardening for `FileProposalRepository` under multi-process access.
3. Add startup reconciliation for persisted proposals whose patch/worktree artifacts were removed by OS temp cleanup.
4. Add integration tests for process-restart recovery with apply/reject commands.
5. Consider exposing a compact `delegation status` command that summarizes run + proposal state in one message.
