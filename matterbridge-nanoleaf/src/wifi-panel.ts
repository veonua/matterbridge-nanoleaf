/**
 * @file src/wifi-panel.ts
 * @description Nanoleaf Wi-Fi OpenAPI light device.
 * @license Apache-2.0
 */

import type { NanoleafDeviceInfo, NanoleafLightDevice, NanoleafLightState } from './device.js';

type ApiValue = { value?: unknown };
type ApiState = {
  on?: ApiValue;
  brightness?: ApiValue;
  hue?: ApiValue;
  sat?: ApiValue;
  ct?: ApiValue;
};

type ApiInfo = {
  serialNo?: unknown;
  hardwareVersion?: unknown;
  firmwareVersion?: unknown;
};

function numberValue(value: ApiValue | undefined, fallback = 0): number {
  return typeof value?.value === 'number' && Number.isFinite(value.value) ? value.value : fallback;
}

function booleanValue(value: ApiValue | undefined): boolean {
  return value?.value === true;
}

function isApiState(value: unknown): value is ApiState {
  return typeof value === 'object' && value !== null;
}

function hostForUrl(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

/** Nanoleaf panel using the legacy HTTP OpenAPI discovered over mDNS. */
export class WiFiPanelDevice implements NanoleafLightDevice {
  readonly host: string;
  private readonly baseUrl: string;

  constructor(
    host: string,
    private readonly port: number,
    private token: string,
  ) {
    this.host = host;
    this.baseUrl = `http://${hostForUrl(host)}:${port}/api/v1`;
  }

  async connect(): Promise<void> {
    if (!this.token) throw new Error('Nanoleaf Wi-Fi OpenAPI token is missing');
    await Promise.resolve();
  }

  async pair(): Promise<string> {
    const response = await fetch(`${this.baseUrl}/new`, { method: 'POST', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Nanoleaf Wi-Fi pairing failed with HTTP ${response.status}`);
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null || !('auth_token' in body) || typeof body.auth_token !== 'string' || body.auth_token.length === 0) {
      throw new Error('Nanoleaf Wi-Fi pairing response did not contain auth_token');
    }
    this.token = body.auth_token;
    return this.token;
  }

  async state(): Promise<NanoleafLightState> {
    const response = await this.request('GET', 'state');
    if (!isApiState(response)) throw new Error('Nanoleaf Wi-Fi state response was invalid');
    const state = response;
    return {
      on: booleanValue(state.on),
      brightness: numberValue(state.brightness),
      hue: numberValue(state.hue),
      saturation: numberValue(state.sat),
      cct: numberValue(state.ct),
    };
  }

  async deviceInfo(): Promise<NanoleafDeviceInfo> {
    const response = await this.request('GET', '');
    if (typeof response !== 'object' || response === null) throw new Error('Nanoleaf Wi-Fi metadata response was invalid');
    const info = response as ApiInfo;
    return {
      serialNumber: typeof info.serialNo === 'string' ? info.serialNo : undefined,
      hardwareVersion: typeof info.hardwareVersion === 'string' ? info.hardwareVersion : undefined,
      firmwareVersion: typeof info.firmwareVersion === 'string' ? info.firmwareVersion : undefined,
    };
  }

  async setPower(on: boolean): Promise<void> {
    await this.request('PUT', 'state', { on: { value: on } });
  }

  async setBrightness(value: number): Promise<void> {
    await this.request('PUT', 'state', { brightness: { value } });
  }

  async setHueAndSaturation(hue: number, saturation: number): Promise<void> {
    await this.request('PUT', 'state', { hue: { value: hue }, sat: { value: saturation } });
  }

  async setColorTemperature(cct: number): Promise<void> {
    await this.request('PUT', 'state', { ct: { value: cct } });
  }

  async identify(): Promise<void> {
    await this.request('PUT', 'identify');
  }

  close(): void {
    // fetch has no persistent client resource to close.
  }

  private async request(method: 'GET' | 'PUT', path: string, body?: unknown): Promise<unknown> {
    const options: RequestInit = {
      method,
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    };
    if (body !== undefined) options.body = JSON.stringify(body);
    const response = await fetch(`${this.baseUrl}/${this.token}/${path}`, options);
    if (!response.ok) throw new Error(`Nanoleaf Wi-Fi ${method} ${path} failed with HTTP ${response.status}`);
    if (response.status === 204) return {};
    return response.json();
  }
}
