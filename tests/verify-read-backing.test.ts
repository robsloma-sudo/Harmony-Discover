import { describe, expect, it } from 'vitest';
import { backing, pointsToAnother } from '../supabase/functions/discover-verify-read/backing';

const curedOak = { brand: 'Colonel E.H. Taylor', product: 'Cured Oak' };
const barrelProof = { brand: 'Colonel E.H. Taylor', product: 'Barrel Proof' };
const duncan = { brand: 'Duncan Taylor', product: 'Octave' };

describe('the targeted check is accepted only when the visible words back the chosen name', () => {
  it('a product word only the chosen name has backs the product', () => {
    expect(backing(curedOak, [barrelProof, duncan], ['TAYLO', 'CURED', 'OAK'])).toBe('product');
    expect(backing(curedOak, [barrelProof], ['URED'])).toBe('product');           // CURED cut at the left edge
    expect(backing(curedOak, [barrelProof], ['URE'])).toBe('none');               // too little left to tell
  });

  it('a brand word another maker shares does not back the brand', () => {
    expect(backing(curedOak, [duncan], ['TAYLOR'])).toBe('none');
    expect(backing(curedOak, [duncan], ['E.H.', 'TAYLOR'])).toBe('brand');
    expect(backing(curedOak, [barrelProof], ['COLONEL', 'E.H.', 'TAYLOR'])).toBe('brand');
  });

  it('a word two candidates share does not pick between them', () => {
    expect(backing({ brand: 'Colonel E.H. Taylor', product: 'Toasted Oak' }, [curedOak], ['E.H. TAYLOR', 'OAK'])).toBe('brand');
  });

  it('only words of another candidate make it a tie; the front bottle\'s label does not', () => {
    expect(pointsToAnother(curedOak, [barrelProof, duncan], ['BARREL PROOF'])).toBe(true);
    expect(pointsToAnother(curedOak, [barrelProof, duncan], ['KNOB CREEK', '21'])).toBe(false);
    expect(pointsToAnother(curedOak, [barrelProof], ['KENTUCKY STRAIGHT BOURBON'])).toBe(false);
  });
});
