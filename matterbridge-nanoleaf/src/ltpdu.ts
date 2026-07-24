import { createCipheriv, createHash, createPublicKey, diffieHellman, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { createSocket, type Socket } from 'node:dgram';

const POST = 2;
const GET = 1;
const TLV_ENDPOINT = 0x0001;
const TLV_ARGUMENT = 0x0002;
const TLV_RESULT = 0x0003;

export type LtpduState = { on: boolean; brightness: number; hue: number; saturation: number; cct: number };
export type LtpduDeviceInfo = { serialNumber: string; hardwareVersion: string; firmwareVersion: string };

function cleanDeviceText(value: Buffer): string {
  return value.toString('ascii').replaceAll(String.fromCharCode(0), '').trim();
}

function tlv(tag: number, value: Uint8Array): Buffer {
  const result = Buffer.allocUnsafe(4 + value.length);
  result.writeUInt16BE(tag, 0);
  result.writeUInt16BE(value.length, 2);
  Buffer.from(value).copy(result, 4);
  return result;
}

function readTlv(data: Buffer, offset = 0): { tag: number; value: Buffer; next: number } {
  if (offset + 4 > data.length) throw new Error('Short LTPDU TLV');
  const tag = data.readUInt16BE(offset);
  const length = data.readUInt16BE(offset + 2);
  const end = offset + 4 + length;
  if (end > data.length) throw new Error('Truncated LTPDU TLV');
  return { tag, value: data.subarray(offset + 4, end), next: end };
}

export function parseState(data: Buffer): LtpduState {
  const state: LtpduState = { on: false, brightness: 0, hue: 0, saturation: 0, cct: 0 };
  let offset = 0;
  while (offset < data.length) {
    const endpoint = readTlv(data, offset);
    const result = readTlv(data, endpoint.next);
    if (result.tag !== TLV_RESULT || result.value.length < 2) throw new Error('Invalid LTPDU state response');
    const raw = result.value.subarray(1);
    const value = raw.readUIntBE(0, raw.length);
    switch (endpoint.value.toString('ascii')) {
      case 'lb/0/oo':
        state.on = value !== 0;
        break;
      case 'lb/0/pb':
        state.brightness = value;
        break;
      case 'lb/0/hu':
        state.hue = value;
        break;
      case 'lb/0/sa':
        state.saturation = value;
        break;
      case 'lb/0/ct':
        state.cct = value;
        break;
      default:
        break;
    }
    offset = result.next;
  }
  return state;
}

function rawPublicKey(key: KeyObject): Buffer {
  return key.export({ format: 'der', type: 'spki' }).subarray(-32);
}

export class LtpduClient {
  private socket?: Socket;
  private cipher?: ReturnType<typeof createCipheriv>;
  private messageId = 1;
  private secureQueue: Promise<Buffer> = Promise.resolve(Buffer.alloc(0));

  constructor(
    private readonly host: string,
    private readonly port = 5683,
    private readonly token: string,
  ) {}

  private async request(path: string, code: number, payload: Buffer): Promise<Buffer> {
    this.socket ??= createSocket(this.host.includes(':') ? 'udp6' : 'udp4');
    const messageId = this.messageId++ % 65536;
    const pathOptions = path
      .split('/')
      .filter(Boolean)
      .map((part): Buffer => Buffer.from([176 + part.length, ...Buffer.from(part)]));
    const header = Buffer.from([0x40, code, Math.floor(messageId / 256), messageId % 256]);
    const packet = Buffer.concat([header, ...pathOptions, payload.length ? Buffer.from([0xff]) : Buffer.alloc(0), payload]);
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`LTPDU request timed out: ${path}`)), 5000);
      const onMessage = (response: Buffer): void => {
        clearTimeout(timer);
        this.socket?.off('message', onMessage);
        const marker = response.indexOf(0xff, 4);
        resolve(marker >= 0 ? response.subarray(marker + 1) : Buffer.alloc(0));
      };
      this.socket?.on('message', onMessage);
      this.socket?.send(packet, this.port, this.host, (error) => {
        if (error) {
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  }

  async connect(): Promise<void> {
    const { privateKey, publicKey } = generateKeyPairSync('x25519');
    const response = readTlv(await this.request('nlsecure', POST, tlv(0x0101, rawPublicKey(publicKey))));
    const deviceKey = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), response.value]), format: 'der', type: 'spki' });
    const shared = diffieHellman({ privateKey, publicKey: deviceKey });
    const digest = (label: string): Buffer => createHash('sha1').update(label).update(shared).digest().subarray(0, 16);
    this.cipher = createCipheriv('aes-128-ctr', digest('AES-NL-OPENAPI-KEY'), digest('AES-NL-OPENAPI-IV'));
    const result = readTlv(this.cipher.update(await this.request('nlsecure', POST, this.cipher.update(tlv(0x0104, Buffer.from(this.token, 'hex'))))));
    if (result.tag !== 0x01f1 || result.value[0] !== 0) throw new Error('LTPDU token rejected');
  }

  async pair(pin: string): Promise<string> {
    const { privateKey, publicKey } = generateKeyPairSync('x25519');
    const response = readTlv(await this.request('nlsecure', POST, tlv(0x0101, rawPublicKey(publicKey))));
    const deviceKey = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), response.value]), format: 'der', type: 'spki' });
    const shared = diffieHellman({ privateKey, publicKey: deviceKey });
    const digest = (label: string): Buffer => createHash('sha1').update(label).update(shared).digest().subarray(0, 16);
    this.cipher = createCipheriv('aes-128-ctr', digest('AES-NL-OPENAPI-KEY'), digest('AES-NL-OPENAPI-IV'));
    const result = readTlv(this.cipher.update(await this.request('nlsecure', POST, this.cipher.update(tlv(0x0103, Buffer.from(pin, 'ascii'))))));
    if (result.tag !== 0x0104 || result.value.length !== 8) throw new Error('LTPDU PIN rejected');
    return result.value.toString('hex');
  }

  private async secure(path: string, code: number, plaintext: Buffer): Promise<Buffer> {
    const operation = this.secureQueue.then(async () => {
      try {
        if (!this.cipher) await this.connect();
        const cipher = this.cipher;
        if (!cipher) throw new Error('LTPDU cipher is not initialized');
        return cipher.update(await this.request(path, code, cipher.update(plaintext)));
      } catch (error) {
        this.close();
        throw error;
      }
    });
    this.secureQueue = operation.then(
      () => Buffer.alloc(0),
      () => Buffer.alloc(0),
    );
    return operation;
  }

  async state(): Promise<LtpduState> {
    const endpoints = ['lb/0/oo', 'lb/0/pb', 'lb/0/hu', 'lb/0/sa', 'lb/0/ct'];
    const payload = Buffer.concat(endpoints.flatMap((endpoint) => [tlv(TLV_ENDPOINT, Buffer.from(endpoint)), tlv(TLV_ARGUMENT, Buffer.alloc(0))]));
    return parseState(await this.secure('nlltpdu', GET, payload));
  }

  async deviceInfo(): Promise<LtpduDeviceInfo> {
    const payload = Buffer.concat([tlv(TLV_ENDPOINT, Buffer.from('di')), tlv(TLV_ARGUMENT, Buffer.alloc(0))]);
    const data = await this.secure('nlltpdu', GET, payload);
    let offset = 0;
    while (offset < data.length) {
      const endpoint = readTlv(data, offset);
      const result = readTlv(data, endpoint.next);
      if (endpoint.value.toString('ascii') === 'di' && result.tag === TLV_RESULT && result.value.length >= 1 + 10 + 8 + 11) {
        const value = result.value.subarray(1);
        return {
          hardwareVersion: cleanDeviceText(value.subarray(0, 10)),
          firmwareVersion: cleanDeviceText(value.subarray(10, 18)),
          serialNumber: cleanDeviceText(value.subarray(18, 29)),
        };
      }
      offset = result.next;
    }
    throw new Error('LTPDU device-info response did not contain a serial number');
  }

  async set(endpoint: string, value: number, bytes = 2): Promise<void> {
    const payload = Buffer.alloc(bytes);
    payload.writeUIntBE(value, 0, bytes);
    await this.secure('nlltpdu', POST, Buffer.concat([tlv(TLV_ENDPOINT, Buffer.from(endpoint)), tlv(TLV_ARGUMENT, payload)]));
  }

  async identify(): Promise<void> {
    await this.request('nlpublic', POST, Buffer.concat([tlv(TLV_ENDPOINT, Buffer.from('lb/0/id')), tlv(TLV_ARGUMENT, Buffer.alloc(0))]));
  }

  close(): void {
    this.socket?.close();
    this.socket = undefined;
    this.cipher = undefined;
  }
}
