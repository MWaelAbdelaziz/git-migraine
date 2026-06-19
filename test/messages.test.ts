import { describe, expect, it } from 'vitest';
import { interpolate } from '../src/messages.js';

describe('interpolate', () => {
  it('replaces tokens with values', () => {
    expect(
      interpolate('Switched from {fromBranch} to {toBranch}', {
        fromBranch: 'main',
        toBranch: 'feature',
      }),
    ).toBe('Switched from main to feature');
  });

  it('stringifies numbers', () => {
    expect(interpolate('{n} applied', { n: 3 })).toBe('3 applied');
  });

  it('leaves unknown tokens untouched', () => {
    expect(interpolate('hi {missing}', {})).toBe('hi {missing}');
  });

  it('replaces every occurrence', () => {
    expect(interpolate('{x}-{x}', { x: 'a' })).toBe('a-a');
  });
});
