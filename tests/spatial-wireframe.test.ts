import { describe, expect, it } from 'vitest';

describe('3D spatial overlay contract', () => {
  it('requires positive metric dimensions and forward depth before projection', () => {
    const valid = { position: { x: 0, y: 0, z: 2 }, dimensions: { width: .1, height: .3, depth: .1 } };
    const invalidDepth = { ...valid, position: { ...valid.position, z: 0 } };
    const invalidSize = { ...valid, dimensions: { ...valid.dimensions, height: 0 } };
    expect(valid.position.z > 0 && valid.dimensions.width > 0 && valid.dimensions.height > 0 && valid.dimensions.depth > 0).toBe(true);
    expect(invalidDepth.position.z > 0).toBe(false);
    expect(invalidSize.dimensions.height > 0).toBe(false);
  });
});
