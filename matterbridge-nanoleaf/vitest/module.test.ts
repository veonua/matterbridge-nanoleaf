import { describe, expect, it } from 'vitest';

import { parseState } from '../src/nl55.js';

function tlv(tag: number, value: Buffer): Buffer {
  const result = Buffer.alloc(4 + value.length);
  result.writeUInt16BE(tag, 0);
  result.writeUInt16BE(value.length, 2);
  value.copy(result, 4);
  return result;
}

function response(endpoint: string, value: number, bytes = 2): Buffer {
  const raw = Buffer.alloc(1 + bytes);
  raw.writeUInt8(0, 0);
  raw.writeUIntBE(value, 1, bytes);
  return Buffer.concat([tlv(1, Buffer.from(endpoint)), tlv(3, raw)]);
}

describe('NL55 protocol helpers', () => {
  it('parses the documented NL55 state endpoints', () => {
    const data = Buffer.concat([response('lb/0/oo', 1, 1), response('lb/0/pb', 95), response('lb/0/hu', 247), response('lb/0/sa', 64), response('lb/0/ct', 2700)]);

    expect(parseState(data)).toEqual({ on: true, brightness: 95, hue: 247, saturation: 64, cct: 2700 });
  });

  it('rejects truncated responses', () => {
    expect(() => parseState(Buffer.from([0, 1, 0]))).toThrow('Short NL55 TLV');
  });
});
