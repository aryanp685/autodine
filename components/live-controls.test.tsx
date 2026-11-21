import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Nothing on these screens may be a decoration.
 *
 * Two claims that a screenshot can never settle, and that a passing typecheck
 * cannot either:
 *
 *   1. Every internal link points at a page this app actually serves. A dead
 *      link is a dead button: it is styled, it is focusable, and it goes
 *      nowhere.
 *   2. Every `<button>` does something -- it is a submit inside a form, it
 *      carries a handler, or it is deliberately disabled with its reason on
 *      screen. A `<button>` with none of those is the "fake control" this
 *      product has already had to remove once.
 *
 * These read the source, because the behaviour they describe is a property of
 * what was written, not of one render. What they cannot do is prove a handler
 * works when it is clicked -- there is no browser in this sandbox -- so they
 * are a floor, not a ceiling.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Every URL the app serves, from the files that serve it. */
function servedRoutes(dir = join(ROOT, 'app'), out = new Set<string>()): Set<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      servedRoutes(full, out);
      continue;
    }
    if (entry !== 'page.tsx' && entry !== 'route.ts') continue;
    // A route handler without GET is an endpoint, not a destination: a link to
    // one answers 405. Only pages and GET endpoints can be linked to.
    if (entry === 'route.ts' && !/export\s+(async\s+function\s+GET|const\s+GET)/.test(readFileSync(full, 'utf8')))
      continue;
    const rel = full.slice(join(ROOT, 'app').length + 1, full.lastIndexOf('/'));
    // Route groups and private folders do not appear in a URL.
    const url =
      '/' +
      rel
        .split('/')
        .filter((s) => s && !s.startsWith('(') && !s.startsWith('_'))
        .join('/');
    out.add(url === '/' ? '/' : url);
  }
  return out;
}

/** Does a concrete path match a route, allowing [param] and [...rest]? */
function matchesHref(pathname: string, route: string): boolean {
  const a = pathname.split('/').filter(Boolean);
  const b = route.split('/').filter(Boolean);
  let i = 0;
  for (; i < b.length; i++) {
    if (b[i].startsWith('[...')) return true;
    if (a[i] === undefined) return false;
    if (!b[i].startsWith('[') && b[i] !== a[i]) return false;
  }
  return a.length === i;
}

/** Comments describe code; they are not controls. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** The opening tag starting at an index, with attribute expressions respected. */
function tagAt(source: string, start: number): string {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '>' && depth === 0) return source.slice(start, i + 1);
  }
  return source.slice(start);
}

describe('every internal link goes somewhere', () => {
  it('resolves against the routes the app serves', () => {
    const routes = [...servedRoutes()];
    const files = [...walk(join(ROOT, 'components')), ...walk(join(ROOT, 'app'))];
    const dead: string[] = [];

    for (const file of files) {
      const source = stripComments(readFileSync(file, 'utf8'));
      for (const match of source.matchAll(/href=(?:"|\{'|`)(\/[^"'`$]*)/g)) {
        const href = match[1].split('?')[0].split('#')[0];
        if (!href || href === '/') continue;
        if (!routes.some((route) => matchesHref(href, route))) {
          dead.push(`${href} (${file.slice(ROOT.length + 1)})`);
        }
      }
    }

    expect(dead).toEqual([]);
  });
});

describe('kit class strings are overridden explicitly', () => {
  /**
   * The kit's field strings carry `h-11`, `w-full` and `text-[13.5px]`. Tailwind
   * sorts same-property utilities by value, so appending a SMALLER one is a
   * silent no-op: `.h-8` lands before `.h-11` in the stylesheet, `.w-[142px]`
   * before `.w-full`. Three fields shipped that way, rendering full-width and
   * 44px tall while their code said 142px and 32px.
   *
   * The fix is the important suffix (`w-[142px]!`), and this is the rule that
   * keeps it from creeping back.
   */
  const KIT = ['inputClass', 'selectClass', 'textareaClass'] as const;
  const CONFLICTS = /^(h|w|p|px|py|pl|pr|pt|pb|text-\[)/;

  it('never appends a conflicting utility without the important suffix', () => {
    const files = [...walk(join(ROOT, 'components')), ...walk(join(ROOT, 'app'))].filter(
      // The kit is where those defaults are DEFINED; it is not a call site.
      (file) => !file.endsWith(join('owner', 'chrome.tsx')),
    );

    const offenders: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        for (const kit of KIT) {
          const at = line.indexOf('${' + kit + '}');
          if (at === -1) continue;
          const tail = line.slice(at + kit.length + 3).split('`')[0];
          for (const token of tail.split(/\s+/)) {
            if (!token || token.endsWith('!')) continue;
            if (CONFLICTS.test(token)) {
              offenders.push(
                `${file.slice(ROOT.length + 1)}:${index + 1} "${token}" needs a trailing ! to override ${kit}`,
              );
            }
          }
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});

describe('every button does something', () => {
  /**
   * Components that render a submit button for a form their caller supplies.
   * Named here rather than guessed at: each one is a child of `<form>` in every
   * place it is used, and that is the whole reason it exists.
   */
  const FORM_CHILDREN = new Set([
    'components/owner/ConfirmSubmit.tsx',
    'components/owner/SubmitButton.tsx',
    'components/DishPhotoField.tsx',
  ]);

  it('has a handler, a form, or a stated reason to be disabled', () => {
    const targets = [
      'components/owner',
      'components/screens',
      'components/DashboardBar.tsx',
      'components/OutletSwitcher.tsx',
      'components/ShellSearch.tsx',
      'components/DishPhotoField.tsx',
      'components/PronunciationField.tsx',
    ];
    const files = targets.flatMap((target) => {
      const full = join(ROOT, target);
      return /\.tsx$/.test(target) ? [full] : walk(full);
    });

    const dead: string[] = [];
    for (const file of files) {
      const relative = file.slice(ROOT.length + 1);
      const source = stripComments(readFileSync(file, 'utf8'));

      for (const match of source.matchAll(/<button\b/g)) {
        const tag = tagAt(source, match.index);
        const before = source.slice(0, match.index);
        const inForm =
          (before.match(/<form\b/g) ?? []).length > (before.match(/<\/form>/g) ?? []).length;

        const alive =
          /\bonClick=/.test(tag) ||
          /\bformAction=/.test(tag) ||
          /\btype="submit"/.test(tag) && (inForm || FORM_CHILDREN.has(relative)) ||
          /\bdisabled=/.test(tag);

        if (!alive) dead.push(`${relative}: ${tag.slice(0, 90)}`);
      }
    }

    expect(dead).toEqual([]);
  });
});
