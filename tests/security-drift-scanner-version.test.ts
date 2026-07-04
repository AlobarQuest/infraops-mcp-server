import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  readScannerOutputVersion,
  scannerVersionGate,
  EXPECTED_SCANNER_OUTPUT_VERSION,
} from '../src/security-drift/scanner-version.js';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-scanver-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeScanner(body: string): string {
  const p = path.join(dir, 'security-scan.sh');
  fs.writeFileSync(p, body);
  return p;
}

describe('readScannerOutputVersion', () => {
  it('extracts the version from the marker amid other lines', () => {
    const p = writeScanner(
      '#!/bin/bash\n# OUTPUT CONTRACT ...\n# SCANNER_OUTPUT_VERSION=1\necho hi\n',
    );
    expect(readScannerOutputVersion(p)).toBe(1);
  });
  it('returns null when the marker is absent', () => {
    expect(readScannerOutputVersion(writeScanner('#!/bin/bash\necho hi\n'))).toBeNull();
  });
  it('returns null when the file does not exist', () => {
    expect(readScannerOutputVersion(path.join(dir, 'nope.sh'))).toBeNull();
  });
  it('picks the first marker when duplicated', () => {
    expect(
      readScannerOutputVersion(
        writeScanner('# SCANNER_OUTPUT_VERSION=2\n# SCANNER_OUTPUT_VERSION=3\n'),
      ),
    ).toBe(2);
  });
});

describe('scannerVersionGate', () => {
  it('returns null when deployed version == expected', () => {
    expect(scannerVersionGate(writeScanner('# SCANNER_OUTPUT_VERSION=1\n'), 1)).toBeNull();
  });
  it('returns a skew Finding when deployed != expected', () => {
    const f = scannerVersionGate(writeScanner('# SCANNER_OUTPUT_VERSION=2\n'), 1);
    expect(f?.check).toBe('scanner.output_version_skew');
    expect(f?.severity).toBe('FAIL');
    expect(f?.target).toContain('security-scan.sh');
  });
  it('returns a skew Finding when the marker is missing (fail loud)', () => {
    expect(scannerVersionGate(writeScanner('#!/bin/bash\necho hi\n'), 1)?.check).toBe(
      'scanner.output_version_skew',
    );
  });
  it('pins EXPECTED_SCANNER_OUTPUT_VERSION to the current contract (1)', () => {
    expect(EXPECTED_SCANNER_OUTPUT_VERSION).toBe(1);
  });
});
