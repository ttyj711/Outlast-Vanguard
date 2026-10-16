/** Small deterministic PRNG used for every simulation choice in a world. */
export function seedState(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index++) hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619);
  return hash >>> 0 || 0x6d2b79f5;
}

export function nextRandom(state: number): { value: number; state: number } {
  let next = (state + 0x6d2b79f5) >>> 0;
  let value = next;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return { value: ((value ^ (value >>> 14)) >>> 0) / 4294967296, state: next };
}

export function seededRandom(seed: string): () => number {
  let state = seedState(seed);
  return () => {
    const result = nextRandom(state);
    state = result.state;
    return result.value;
  };
}
