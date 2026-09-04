/**
 * ID and slug helpers.
 *
 * IDs are short, prefixed and URL-safe so they read well inside a JSON file that
 * a human may end up editing by hand: `blk_k3f9a2`, `edg_9dk21x`.
 */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomSuffix(length = 6): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

export type IdPrefix = 'dgm' | 'blk' | 'edg' | 'grp';

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomSuffix(8)}`;
}

/** Turn an arbitrary diagram name into a filesystem-safe slug. */
export function slugify(input: string): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || `diagram-${randomSuffix(4)}`;
}

/** Append `-2`, `-3`, ... until the slug is not taken. */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const slug = slugify(base);
  if (!used.has(slug)) return slug;
  let n = 2;
  while (used.has(`${slug}-${n}`)) n++;
  return `${slug}-${n}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
