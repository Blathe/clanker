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
│   └── policy/
│       └── patterns.test.ts    # Policy regex pattern validation
└── README.md                   # This file
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

### Policy Pattern Tests (`unit/policy/patterns.test.ts`)
Tests the regex patterns in `policy.json` to ensure:
- ✅ Read-only commands (ls, cat, grep, etc.) are allowed
- ✅ Command chaining attempts (`;`, `|`, `&&`, `||`) are blocked
- ✅ Dangerous rm patterns (rm -rf) are detected
- ✅ Network commands are blocked
- ✅ Write operations require passphrase
- ✅ Policy rule priorities are enforced

**Total: 42 tests, all passing**

## Adding Security Tests

When adding new security features, add corresponding tests:

1. **Policy Changes** → Update `unit/policy/patterns.test.ts`
2. **Input Validation** → Create `unit/validation/`
3. **Cryptographic Operations** → Create `unit/crypto/`
4. **File Operations** → Create `unit/executor/`
5. **Error Handling** → Create `unit/error-handling/`

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

None currently. All tests passing.

## Future Test Categories

- [ ] Executor tests (command execution, path validation)
- [ ] Logger tests (sensitive data filtering)
- [ ] LLM response validation tests
- [ ] Policy evaluation tests
- [ ] Discord transport tests
- [ ] Integration tests (end-to-end)
