/** Release check: reload only when a known build changes to another known build. */
export function newBuild(seen: string | null, now: unknown): boolean {
  return typeof seen === 'string' && typeof now === 'string' && now !== '' && now !== seen;
}
