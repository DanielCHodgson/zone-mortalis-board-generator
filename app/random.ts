/**
 * Seeded randomness, in one place.
 *
 * Generation has to be reproducible from a seed — a board you liked must come back
 * if you ask for the same seed, and a failing soak run has to be replayable — so
 * nothing here ever touches `Math.random`.
 *
 * Both functions previously existed as byte-identical copies in the modules that
 * needed them: `randomFactory` in build.ts and generate.ts, `shuffle` in build.ts,
 * scatter.ts and deckplan.ts (there under the name `shuffled`). Four copies of a
 * PRNG is four places for the sequence to quietly diverge, which would make a seed
 * mean different things in different stages of the same run.
 */

/**
 * mulberry32. Chosen for being small enough to read and verify at a glance, and
 * for having a full 32-bit state, so successive seeds — `seed + attempt * 7919`,
 * as the generator's candidate loop uses — give unrelated streams rather than
 * correlated ones.
 */
export const randomFactory = (seed:number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
};

/** Fisher-Yates, on a copy. Callers shuffle plan structures they do not own. */
export const shuffle = <T,>(values:T[], random:() => number) => {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
};
