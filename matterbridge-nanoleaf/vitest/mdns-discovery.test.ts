import { DnsClass, DnsRecordType, type MdnsMessage } from 'matterbridge/dgram';

import { normalizeNanoleafMdns } from '../src/mdns-discovery.js';

function message(service: string, instance: string, port: number, address: string): MdnsMessage {
  return {
    id: 0,
    qr: 1,
    opcode: 0,
    aa: true,
    tc: false,
    rd: false,
    ra: false,
    z: 0,
    rcode: 0,
    qdCount: 0,
    anCount: 2,
    nsCount: 0,
    arCount: 3,
    answers: [
      { name: service, type: DnsRecordType.PTR, class: DnsClass.IN, ttl: 120, data: instance },
      { name: instance, type: DnsRecordType.SRV, class: DnsClass.IN, ttl: 120, data: JSON.stringify({ port, target: 'nanoleaf.local' }) },
    ],
    additionals: [
      { name: instance, type: DnsRecordType.TXT, class: DnsClass.IN, ttl: 120, data: 'md=Essentials, id=device-1' },
      { name: 'nanoleaf.local', type: DnsRecordType.AAAA, class: DnsClass.IN, ttl: 120, data: address },
    ],
  };
}

test('normalizes Wi-Fi and Thread Nanoleaf mDNS records', () => {
  const devices = normalizeNanoleafMdns([
    { address: '192.168.1.20', response: message('_nanoleafapi._tcp.local', 'Panels._nanoleafapi._tcp.local', 16021, '192.168.1.20') },
    { address: 'fe80::1', response: message('_ltpdu._udp.local', 'Essentials._ltpdu._udp.local', 5683, 'fe80::1') },
  ]);

  expect(devices).toEqual([
    expect.objectContaining({ id: 'device-1', name: 'Panels', host: '192.168.1.20', port: 16021, protocol: 'wifi-openapi', model: 'Essentials' }),
    expect.objectContaining({ id: 'device-1', name: 'Essentials', host: 'fe80::1', port: 5683, protocol: 'ltpdu', model: 'Essentials' }),
  ]);
});

test('ignores responses without a Nanoleaf service record', () => {
  const empty: MdnsMessage = { id: 0, qr: 1, opcode: 0, aa: true, tc: false, rd: false, ra: false, z: 0, rcode: 0, qdCount: 0, anCount: 0, nsCount: 0, arCount: 0, answers: [] };
  expect(normalizeNanoleafMdns([{ address: '192.168.1.20', response: empty }])).toEqual([]);
});
