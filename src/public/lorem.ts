// Placeholder text for the public page. Nothing here is derived from real activity: it only has to
// look like activity, and it is different every time.

const WORDS = [
  'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit', 'sed', 'do', 'eiusmod',
  'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore', 'magna', 'aliqua', 'enim', 'ad', 'minim',
  'veniam', 'quis', 'nostrud', 'exercitation', 'ullamco', 'laboris', 'nisi', 'aliquip', 'ex', 'ea',
  'commodo', 'consequat', 'duis', 'aute', 'irure', 'in', 'reprehenderit', 'voluptate', 'velit', 'esse',
  'cillum', 'fugiat', 'nulla', 'pariatur', 'excepteur', 'sint', 'occaecat', 'cupidatat', 'non',
  'proident', 'sunt', 'culpa', 'qui', 'officia', 'deserunt', 'mollit', 'anim', 'id', 'est', 'laborum',
] as const;

const MIN_WORDS = 2;
const MAX_WORDS = 12;

const ROUTINE_SUBJECTS = ['Lorem', 'Ipsum', 'Dolor', 'Amet', 'Elit', 'Magna', 'Nunc', 'Sed'] as const;
const ROUTINE_KINDS = ['sync', 'digest', 'report', 'backup', 'sweep', 'recap', 'scan'] as const;

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)] as T;
}

/** A short random sentence of 2 to 12 words. */
export function loremSentence(): string {
  const count = MIN_WORDS + Math.floor(Math.random() * (MAX_WORDS - MIN_WORDS + 1));
  const words = Array.from({ length: count }, () => pick(WORDS));
  const text = words.join(' ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}${Math.random() < 0.7 ? '.' : ''}`;
}

/** A made-up routine name that fits the mailroom board (12 characters at most). */
export function loremRoutineName(): string {
  return `${pick(ROUTINE_SUBJECTS)} ${pick(ROUTINE_KINDS)}`;
}
