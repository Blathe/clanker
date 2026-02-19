# Clanker Test Suite

Unit and integration tests for the Clanker security-focused CLI agent.

## Running Tests

### Run all tests
```bash
npm test
```

### Watch mode (re-run tests on file changes)
```bash
npm run test:watch
```

### Generate coverage report
```bash
npm run test:coverage
```

## Test Structure

```
tests/
├── unit/
│   ├── context/
│   │   ├── session-filename.test.ts      # Session file naming validation
│   │   └── session-file-validation.test.ts # Session file format validation
│   ├── executor/
│   │   ├── command-length.test.ts        # Command length validation
│   │   └── toctou-race-condition.test.ts # Time-of-check/time-of-use race condition prevention
│   ├── llm/
│   │   └── api-key-validation.test.ts    # OpenAI/Anthropic API key format validation
│   ├── main/
│   │   ├── session-limit.test.ts         # Max concurrent session limit enforcement
│   │   └── session-history.test.ts       # Session history trimming and limits
│   ├── policy/
│   │   └── patterns.test.ts              # Policy regex pattern validation (73 tests)
│   ├── queue/
│   │   └── job-queue.test.ts             # Job queue capacity and execution (8 tests)
│   ├── transports/
│   │   └── input-limit.test.ts           # Input length validation
└── README.md                             # This file
```

## Writing New Tests

### Test File Naming
- Test files should end with `.test.ts`
- Place them in appropriate `tests/unit/[feature]/` directories
- Mirror the source code structure for organization

### Example Test Structure
```typescript
describe('Feature Name', () => {
  describe('Sub-feature', () => {
    test('should do something', () => {
      // Arrange
      const input = { /* ... */ };

      // Act
      const result = functionUnderTest(input);

      // Assert
      expect(result).toBe(expected);
    });

    test.each(testCases)(
      'should handle: $description',
      ({ input, expected }) => {
        expect(functionUnderTest(input)).toEqual(expected);
      }
    );
  });
});
```

## Current Test Coverage

### 181 Total Tests (10 Test Suites)

**Policy Tests** (`unit/policy/patterns.test.ts` — 73 tests)
- ✅ Allow-reads rule: ls, cat, grep, find, pwd, which, env, etc.
- ✅ Block-network rule: curl, wget, nc, ssh, scp
- ✅ Block-rm-rf rule: rm -rf dangerous patterns
- ✅ Secret-for-write rule: tee, mv, cp, mkdir, touch, chmod, sed, redirects
- ✅ Allow-git-commands rule: status, log, diff, add, commit, fetch, pull, merge (blocks --hard, --force, -D, -f)
- ✅ Command chaining prevention: `;`, `|`, `&&`, `||` blocked
- ✅ Rule priority enforcement: first match wins

**Session Management Tests** (`unit/main/session-*.test.ts` — 12 tests)
- ✅ Session limit enforcement (max 100 concurrent)
- ✅ Session history trimming (prevent unbounded memory growth)

**Job Queue Tests** (`unit/queue/job-queue.test.ts` — 8 tests)
- ✅ Async job execution and completion
- ✅ Error handling and resilience
- ✅ Queue capacity management (max 10 concurrent)
- ✅ Concurrent job execution
- ✅ History mutation and notifications

**Input Validation Tests** (`unit/transports/input-limit.test.ts`)
- ✅ Discord message length limits (max 8000 chars)

**Executor Tests** (`unit/executor/command-*.test.ts`)
- ✅ Command length validation
- ✅ TOCTOU (Time-of-check/time-of-use) race condition prevention

**API Key Validation Tests** (`unit/llm/api-key-validation.test.ts`)
- ✅ OpenAI API key format validation
- ✅ Anthropic API key format validation

**Context/Session Tests** (`unit/context/*.test.ts`)
- ✅ Session filename format validation
- ✅ Session file JSON format validation

## Adding Tests (TDD Workflow)

When implementing new features, follow Test-Driven Development:

1. **Write tests first** for the feature
2. **Tests should fail** (red state)
3. **Implement the feature** to make tests pass
4. **Run full suite** to ensure no regressions
5. **Commit** with tests included

### Test Categories by Feature Type

1. **Policy Changes** → Update `unit/policy/patterns.test.ts`
   - Add test cases for new rules and blocked patterns
2. **Session Management** → Update/create `unit/main/*.test.ts`
   - Test session limits, cleanup, history management
3. **Input Validation** → Update `unit/transports/` or create new
   - Test length limits, format validation, edge cases
4. **Queue/Async** → Update `unit/queue/job-queue.test.ts`
   - Test concurrency, error handling, capacity
5. **File Operations** → Update `unit/executor/*.test.ts`
   - Test race conditions, path validation
6. **API Keys** → Update `unit/llm/api-key-validation.test.ts`
   - Test format validation for each provider

## Jest Configuration

- **Config File**: `jest.config.js`
- **TypeScript Config**: `tsconfig.test.json`
- **Test Environment**: Node.js
- **Transforms**: ts-jest (TypeScript to JavaScript)

## Debugging Tests

### Run specific test file
```bash
npm test -- patterns.test.ts
```

### Run tests matching a pattern
```bash
npm test -- --testNamePattern="allow-reads"
```

### Run with verbose output
```bash
npm test -- --verbose
```

### Run with debugging
```bash
node --inspect-brk node_modules/.bin/jest --runInBand
```

## CI/CD Integration

Tests should pass before committing:
```bash
npm test && npm run lint && npm run type-check
```

## Known Issues

None currently. All 181 tests passing.

## Future Test Categories

- [ ] Logger tests (sensitive data filtering, session event logging)
- [ ] LLM response validation (Zod schema validation, structured output parsing)
- [ ] Discord transport integration (message handling, rate limiting)
- [ ] REPL transport tests (slash command handling, interactive mode)
- [ ] Policy evaluation integration (policy + executor interaction)
- [ ] Integration/end-to-end tests (full conversation flows)
- [ ] Performance tests (queue throughput, session memory usage)
