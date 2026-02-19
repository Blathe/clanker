/**
 * Unit tests for policy regex patterns
 * Tests that policy rules correctly match and reject commands as expected
 */

import { readFileSync } from 'fs';

// Load policy.json from the project root
const policyPath = process.cwd() + '/policy.json';
const policy = JSON.parse(readFileSync(policyPath, 'utf8'));

interface TestCase {
  cmd: string;
  shouldMatch: boolean;
  reason?: string;
}

describe('Policy Regex Patterns', () => {
  describe('allow-reads rule', () => {
    const rule = policy.rules.find((r: any) => r.id === 'allow-reads');
    const regex = new RegExp(rule.pattern);

    const testCases: TestCase[] = [
      // Valid read operations
      { cmd: 'ls', shouldMatch: true },
      { cmd: 'ls -la', shouldMatch: true },
      { cmd: 'cat file.txt', shouldMatch: true },
      { cmd: 'find . -name "*.js"', shouldMatch: true },
      { cmd: 'grep pattern file.txt', shouldMatch: true },
      { cmd: 'pwd', shouldMatch: true },
      { cmd: 'which bash', shouldMatch: true },

      // Command chaining attempts — should be blocked
      { cmd: 'cat file.txt; rm -rf /', shouldMatch: false, reason: 'Command chaining blocked' },
      { cmd: 'cat file.txt | grep foo', shouldMatch: false, reason: 'Pipe blocked' },
      { cmd: 'env | grep API', shouldMatch: false, reason: 'Pipe blocked' },
      { cmd: 'ls && whoami', shouldMatch: false, reason: 'AND operator blocked' },
      { cmd: 'ls || echo hacked', shouldMatch: false, reason: 'OR operator blocked' },
    ];

    test.each(testCases)(
      'should ${shouldMatch ? "match" : "not match"}: "$cmd"${reason ? ` (${reason})` : ""}',
      ({ cmd, shouldMatch, reason }) => {
        const matches = regex.test(cmd);
        expect(matches).toBe(shouldMatch);
      }
    );
  });

  describe('block-rm-rf rule', () => {
    const rule = policy.rules.find((r: any) => r.id === 'block-rm-rf');
    const regex = new RegExp(rule.pattern);

    const testCases: TestCase[] = [
      // Dangerous combinations that should be blocked
      { cmd: 'rm -rf /', shouldMatch: true },
      { cmd: 'rm -f -r /', shouldMatch: true },
      { cmd: 'rm --recursive --force /', shouldMatch: true },
      { cmd: 'rm --force --recursive /', shouldMatch: true },
      { cmd: 'rm -fr /', shouldMatch: true },
      { cmd: 'rm -rf /path/to/dir', shouldMatch: true },
      { cmd: 'rm -irf /', shouldMatch: true, reason: '-irf contains both i, r, and f' },

      // Safe rm operations that should not be blocked
      { cmd: 'rm -r /', shouldMatch: false, reason: 'Only -r, not -f' },
      { cmd: 'rm -f /', shouldMatch: false, reason: 'Only -f, not -r' },
      { cmd: 'rm -i file.txt', shouldMatch: false, reason: 'Only interactive flag' },
      { cmd: 'rm file.txt', shouldMatch: false, reason: 'No recursive or force' },
    ];

    test.each(testCases)(
      'should ${shouldMatch ? "block" : "allow"}: "$cmd"${reason ? ` (${reason})` : ""}',
      ({ cmd, shouldMatch, reason }) => {
        const matches = regex.test(cmd);
        expect(matches).toBe(shouldMatch);
      }
    );
  });

  describe('block-network rule', () => {
    const rule = policy.rules.find((r: any) => r.id === 'block-network');
    const regex = new RegExp(rule.pattern);

    const testCases: TestCase[] = [
      // Network commands that should be blocked
      { cmd: 'curl https://example.com', shouldMatch: true },
      { cmd: 'wget https://example.com', shouldMatch: true },
      { cmd: 'ssh user@host', shouldMatch: true },
      { cmd: 'scp file user@host:/path', shouldMatch: true },
      { cmd: 'nc -l 8080', shouldMatch: true },

      // Non-network commands that should not be blocked
      { cmd: 'ls', shouldMatch: false },
      { cmd: 'echo hello', shouldMatch: false },
    ];

    test.each(testCases)(
      'should ${shouldMatch ? "block" : "allow"}: "$cmd"',
      ({ cmd, shouldMatch }) => {
        const matches = regex.test(cmd);
        expect(matches).toBe(shouldMatch);
      }
    );
  });

  describe('secret-for-write rule', () => {
    const rule = policy.rules.find((r: any) => r.id === 'secret-for-write');
    const regex = new RegExp(rule.pattern);

    const testCases: TestCase[] = [
      // Write operations that require passphrase
      { cmd: 'tee file.txt', shouldMatch: true },
      { cmd: 'mv source dest', shouldMatch: true },
      { cmd: 'cp source dest', shouldMatch: true },
      { cmd: 'mkdir newdir', shouldMatch: true },
      { cmd: 'touch newfile', shouldMatch: true },
      { cmd: 'chmod 755 file', shouldMatch: true },
      { cmd: 'echo "data" > file.txt', shouldMatch: true },
      { cmd: 'echo "data" >> file.txt', shouldMatch: true },

      // Read operations that should not require passphrase
      { cmd: 'cat file.txt', shouldMatch: false },
      { cmd: 'ls -la', shouldMatch: false },
    ];

    test.each(testCases)(
      'should ${shouldMatch ? "require secret" : "not require secret"}: "$cmd"',
      ({ cmd, shouldMatch }) => {
        const matches = regex.test(cmd);
        expect(matches).toBe(shouldMatch);
      }
    );
  });

  describe('Policy rule priorities (first match wins)', () => {
    test('allow-reads should match before block-network when command uses grep with pipe', () => {
      const allowReads = policy.rules.find((r: any) => r.id === 'allow-reads');
      const blockNetwork = policy.rules.find((r: any) => r.id === 'block-network');

      const cmd = 'grep text file.txt';

      // grep matches allow-reads
      expect(new RegExp(allowReads.pattern).test(cmd)).toBe(true);
      // grep does not match block-network
      expect(new RegExp(blockNetwork.pattern).test(cmd)).toBe(false);
    });

    test('block-rm-rf should be enforced despite allow-reads in policy order', () => {
      // Since block-rm-rf comes after allow-reads in policy.json,
      // both patterns should match, but first match (allow-reads) might win
      // unless rm -rf is listed before allow-reads in the policy file

      const allowReads = policy.rules.find((r: any) => r.id === 'allow-reads');
      const blockRmRf = policy.rules.find((r: any) => r.id === 'block-rm-rf');

      const cmd = 'rm -rf /';

      // rm -rf should match block-rm-rf
      expect(new RegExp(blockRmRf.pattern).test(cmd)).toBe(true);
      // rm -rf should NOT match allow-reads
      expect(new RegExp(allowReads.pattern).test(cmd)).toBe(false);
    });
  });
});
