#!/usr/bin/env node
/**
 * The master blocker register must stay actionable.
 *
 * WHY THIS EXISTS
 *
 * The register is the one document that answers "who moves what, and what
 * closes it". A row that quietly loses its owner, its acceptance condition
 * or its evidence requirement turns the register back into a narrative
 * list — which is exactly what it replaced.
 *
 * This suite enforces the shape of every open row: one owner, one
 * acceptance condition, one evidence requirement, and a status from the
 * fixed vocabulary. It also checks that the register names the launch
 * decision honestly and that it does not leak a secret value.
 *
 * Exit 0 = every check passed.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const REGISTER = path.join(ROOT, 'qa-evidence', 'day1', 'MASTER_BLOCKER_REGISTER.md');
const source = readFileSync(REGISTER, 'utf8');

/** The open rows: the table body of "The register". */
function openRows() {
  const start = source.indexOf('## The register');
  const end = source.indexOf('## Closed — do not re-open');
  assert.ok(start > 0 && end > start, 'the register must have an open-rows section');
  return source
    .slice(start, end)
    .split('\n')
    .filter((line) => line.startsWith('| **B'))
    .map((line) => {
      const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
      return {
        id: cells[0].replace(/\*/g, ''),
        blocker: cells[1],
        owner: cells[2],
        acceptance: cells[3],
        evidence: cells[4],
        status: cells[5],
      };
    });
}

const rows = openRows();

test('the register has rows and they are numbered', () => {
  assert.ok(rows.length >= 8, `the register must list every open blocker, saw ${rows.length}`);
  const ids = rows.map((row) => row.id);
  assert.equal(new Set(ids).size, ids.length, 'the blocker ids must be unique');
});

test('every open row names exactly ONE owner', () => {
  for (const row of rows) {
    assert.ok(row.owner.length > 0, `${row.id} must name an owner`);
    // One owner means one accountable party. The parenthetical may name
    // the dashboard(s) the owner acts in - that is still one person - but
    // the owner itself may not name two parties.
    const owner = row.owner.split('(')[0].trim();
    assert.match(owner, /^Owner$/, `${row.id} must name the Owner as the single accountable party, found: "${owner}"`);
    assert.doesNotMatch(owner, /\band\b|\bor\b/i, `${row.id} must not name two owners`);
  }
});

test('every open row states one acceptance condition', () => {
  for (const row of rows) {
    assert.ok(row.acceptance.length > 20, `${row.id} must state an acceptance condition`);
    // An acceptance condition names an observable end state, not a task.
    assert.doesNotMatch(
      row.acceptance,
      /^\s*(Implement|Fix|Write|Update|Add|Investigate)\b/i,
      `${row.id}'s acceptance condition must be an end state, not a task`,
    );
    assert.match(
      row.acceptance,
      /\b(is|are|has|have|shows|prints|runs|proves|set|names|printed|green|delivered|authenticated|recorded)\b/i,
      `${row.id}'s acceptance condition must be observable`,
    );
  }
});

test('every open row states one evidence requirement', () => {
  for (const row of rows) {
    assert.ok(row.evidence.length > 20, `${row.id} must state an evidence requirement`);
    assert.match(row.evidence, /qa-evidence|\.md|\.json|log|summary/i, `${row.id}'s evidence must name an artifact`);
  }
});

test('every open row carries a status from the fixed vocabulary', () => {
  const allowed = ['OPEN', 'CLOSED', 'BLOCKED — OWNER AUTHORIZATION REQUIRED'];
  for (const row of rows) {
    const status = row.status.replace(/\*\*/g, '').trim();
    assert.ok(
      allowed.some((candidate) => status.startsWith(candidate)),
      `${row.id} has an unknown status: "${status}"`,
    );
  }
});

test('a hosted run that needs authorization is labelled BLOCKED, not PASS', () => {
  // The directive is explicit: where hosted evidence is unavailable, the
  // honest report is BLOCKED — never PASS.
  for (const row of rows) {
    if (/hosted run|dispatch|authorization required/i.test(`${row.blocker} ${row.acceptance}`)) {
      const status = row.status.replace(/\*\*/g, '').trim();
      assert.ok(
        status.startsWith('OPEN') || status.startsWith('BLOCKED'),
        `${row.id} needs an authorized hosted run and must not read as PASS`,
      );
    }
  }
});

test('the register states the launch decision honestly', () => {
  assert.match(source, /NO-GO/);
  assert.match(source, /zero\s+open P0\s+code defects/i);
  // The decision must not be softened into a pass.
  // "NO-GO" is the decision; a bare "GO" would be a different claim.
  assert.doesNotMatch(source, /\bALL CLEAR\b|\bREADY TO LAUNCH\b/);
  assert.doesNotMatch(source, /(?<!NO-)\bGO\b(?!\w)/, 'a bare GO would be a different decision than NO-GO');
});

test('the register names the deployment fact rather than hiding it', () => {
  assert.match(source, /Preview deployment/);
  assert.match(source, /6pFExiBEDXx7kooBgt6Puu4ksNE4/);
  assert.match(source, /no Vercel setting was changed/i);
});

test('the register never carries a secret value', () => {
  // Only names may appear. A value-shaped secret would be a leak.
  const suspicious = [
    /xkeysib-[A-Za-z0-9-]{10,}/,
    /postgresql:\/\/[^\s'"]*:[^\s'"]+@/,
    /AKIA[0-9A-Z]{16}/,
  ];
  for (const pattern of suspicious) {
    assert.doesNotMatch(source, pattern, `the register must not carry a value matching ${pattern}`);
  }
});

test('the closed table records the resolved items with their evidence', () => {
  const closedStart = source.indexOf('## Closed — do not re-open');
  assert.ok(closedStart > 0, 'the register must have a closed section');
  const closed = source.slice(closedStart);
  for (const item of ['PR #190', 'PR #187', 'PR #192']) {
    assert.ok(closed.includes(item), `${item} must be recorded as closed`);
  }
  assert.match(closed, /ff00d38/);
});

test('the prose count of open rows matches the table it describes', () => {
  // The register states a number in its prose. A stale number is a
  // false statement about the launch decision, so the number is
  // derived from the table rather than trusted.
  const stated = source.match(/NO-GO because (\w+) rows are open/);
  assert.ok(stated, 'the register must state how many rows are open');

  const words = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
    thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  };
  const word = stated[1].toLowerCase();
  const count = words[word] ?? Number(word);
  assert.ok(
    Number.isInteger(count),
    `the stated row count must be a number or a number word, found "${stated[1]}"`,
  );
  assert.equal(
    count,
    rows.length,
    `the register's prose says "${stated[1]}" rows are open, but the table lists ${rows.length}`,
  );
});
