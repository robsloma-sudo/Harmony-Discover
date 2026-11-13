import { describe, expect, it } from 'vitest';
import { decodeEanModules } from '../src/live/browserBarcodeDecoder';

const L: Record<string,string> = { '0001101':'0','0011001':'1','0010011':'2','0111101':'3','0100011':'4','0110001':'5','0101111':'6','0111011':'7','0110111':'8','0001011':'9' };
const G: Record<string,string> = { '0100111':'0','0110011':'1','0011011':'2','0100001':'3','0011101':'4','0111001':'5','0000101':'6','0010001':'7','0001001':'8','0010111':'9' };
const PARITY = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];
function ean13(value:string):string {
  const first=Number(value[0]), left=value.slice(1,7), right=value.slice(7);
  return '101'+[...left].map((digit,i)=>(PARITY[first][i]==='L'?L:G)[Object.keys((PARITY[first][i]==='L'?L:G)).find(k=>(PARITY[first][i]==='L'?L:G)[k]===digit)!]).join('')+'01010'+[...right].map(digit=>Object.keys(L).find(k=>L[k]===digit)!.replace(/[01]/g,b=>b==='0'?'1':'0')).join('')+'101';
}
function ean8(value:string):string {
  return '101'+[...value.slice(0,4)].map(digit=>Object.keys(L).find(k=>L[k]===digit)!).join('')+'01010'+[...value.slice(4)].map(digit=>Object.keys(L).find(k=>L[k]===digit)!.replace(/[01]/g,b=>b==='0'?'1':'0')).join('')+'101';
}

describe('browser EAN decoder',()=>{
  it('decodes a valid EAN-13',()=>expect(decodeEanModules(ean13('4006381333931'))).toEqual({rawValue:'4006381333931',format:'ean_13'}));
  it('normalizes UPC-A represented as a leading-zero EAN-13',()=>expect(decodeEanModules(ean13('0036000291452'))).toEqual({rawValue:'0036000291452',format:'upc_a'}));
  it('decodes EAN-8',()=>expect(decodeEanModules(ean8('96385074'))).toEqual({rawValue:'96385074',format:'ean_8'}));
  it('rejects a checksum-invalid code',()=>expect(decodeEanModules(ean13('4006381333932'))).toBeNull());
});
