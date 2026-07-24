/**
 * @file src/mdns-discovery.ts
 * @description Nanoleaf mDNS discovery for Wi-Fi OpenAPI and Thread LTPDU devices.
 * @license Apache-2.0
 */

import { DnsClass, DnsRecordType, MDNS_MULTICAST_IPV4_ADDRESS, MDNS_MULTICAST_IPV6_ADDRESS, MDNS_MULTICAST_PORT, Mdns, type MdnsMessage } from 'matterbridge/dgram';

import type { NanoleafDiscovery } from './device.js';

const WIFI_SERVICE = '_nanoleafapi._tcp.local';
const LTPDU_SERVICE = '_ltpdu._udp.local';

type MdnsRecord = NonNullable<MdnsMessage['answers']>[number];
type MdnsResponse = { address: string; response: MdnsMessage };

function records(response: MdnsMessage): MdnsRecord[] {
  return [...(response.answers ?? []), ...(response.additionals ?? [])];
}

function txtValues(record: MdnsRecord | undefined): Record<string, string> {
  if (!record?.data) return {};
  return Object.fromEntries(
    record.data.split(/,\s*/).flatMap((entry) => {
      const separator = entry.indexOf('=');
      return separator > 0 ? [[entry.slice(0, separator), entry.slice(separator + 1)]] : [];
    }),
  );
}

function parseSrvData(data: string): { port?: number; target?: string } {
  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const value: Record<string, unknown> = Object.fromEntries(Object.entries(parsed));
    return {
      port: typeof value.port === 'number' ? value.port : undefined,
      target: typeof value.target === 'string' ? value.target : undefined,
    };
  } catch {
    return {};
  }
}

function normalizeService(response: MdnsResponse, service: string, protocol: NanoleafDiscovery['protocol']): NanoleafDiscovery | undefined {
  const all = records(response.response);
  const ptr = all.find((record) => record.type === DnsRecordType.PTR && record.name === service);
  if (!ptr) return undefined;
  const instance = ptr.data;
  const srv = all.find((record) => record.type === DnsRecordType.SRV && record.name === instance);
  if (!srv) return undefined;
  const srvData = parseSrvData(srv.data);
  const txt = txtValues(all.find((record) => record.type === DnsRecordType.TXT && record.name === instance));
  const target = srvData.target?.replace(/\.$/, '');
  const address = all.find((record) => (record.type === DnsRecordType.A || record.type === DnsRecordType.AAAA) && record.name === target)?.data ?? response.address;
  const id = txt.id ?? txt.eui64 ?? instance;
  return {
    id,
    name: instance.replace(`.${service}`, ''),
    host: address,
    port: srvData.port ?? (protocol === 'wifi-openapi' ? 16021 : 5683),
    protocol,
    model: txt.md,
    txt,
  };
}

/**
 * Normalize decoded mDNS responses into Nanoleaf device records.
 * @param {MdnsResponse[]} responses Decoded mDNS responses to inspect.
 * @returns {NanoleafDiscovery[]} Normalized Nanoleaf device records.
 */
export function normalizeNanoleafMdns(responses: MdnsResponse[]): NanoleafDiscovery[] {
  const found = responses.flatMap((response) => [normalizeService(response, WIFI_SERVICE, 'wifi-openapi'), normalizeService(response, LTPDU_SERVICE, 'ltpdu')]);
  const unique = new Map<string, NanoleafDiscovery>();
  for (const device of found) {
    if (device) unique.set(`${device.protocol}:${device.id}`, device);
  }
  return [...unique.values()];
}

/**
 * Discover Nanoleaf services announced on the local IPv4 and IPv6 mDNS networks.
 * @param {number} timeoutMs How long to wait for mDNS responses.
 * @param {string} [interfaceName] Optional network interface name.
 * @returns {Promise<NanoleafDiscovery[]>} Discovered Nanoleaf devices.
 */
export async function discoverNanoleafMdns(timeoutMs = 1500, interfaceName?: string): Promise<NanoleafDiscovery[]> {
  const responses: MdnsResponse[] = [];
  const clients = [
    new Mdns('Nanoleaf mDNS IPv4', MDNS_MULTICAST_IPV4_ADDRESS, MDNS_MULTICAST_PORT, 'udp4', true, interfaceName),
    new Mdns('Nanoleaf mDNS IPv6', MDNS_MULTICAST_IPV6_ADDRESS, MDNS_MULTICAST_PORT, 'udp6', true, interfaceName),
  ];
  for (const client of clients) {
    client.on('error', (): void => undefined);
    client.onResponse = (rinfo, response): void => {
      responses.push({ address: rinfo.address, response });
    };
    client.once('ready', (): void => {
      client.sendQuery([
        { name: WIFI_SERVICE, type: DnsRecordType.PTR, class: DnsClass.IN },
        { name: LTPDU_SERVICE, type: DnsRecordType.PTR, class: DnsClass.IN },
      ]);
    });
    client.start();
  }
  await new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  for (const client of clients) client.stop();
  return normalizeNanoleafMdns(responses);
}

export { DnsClass, LTPDU_SERVICE, WIFI_SERVICE };
