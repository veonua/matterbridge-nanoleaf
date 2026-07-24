/**
 * @file src/nl55-device.ts
 * @description Nanoleaf NL55 implementation of the common light device contract.
 * @license Apache-2.0
 */

import type { NanoleafLightDevice, NanoleafLightState } from './device.js';
import type { NL55Client, NL55DeviceInfo, NL55State } from './nl55.js';

/** Adapt the pre-Matter NL55 LTPDU client to the protocol-independent contract. */
export class NL55Device implements NanoleafLightDevice {
  readonly host: string;

  constructor(
    private readonly client: NL55Client,
    host: string,
  ) {
    this.host = host;
  }

  async connect(): Promise<void> {
    return this.client.connect();
  }

  async state(): Promise<NanoleafLightState> {
    return this.client.state();
  }

  async deviceInfo(): Promise<NL55DeviceInfo> {
    return this.client.deviceInfo();
  }

  async setPower(on: boolean): Promise<void> {
    return this.client.set('lb/0/oo', on ? 1 : 0, 1);
  }

  async setBrightness(value: number): Promise<void> {
    return this.client.set('lb/0/pb', value);
  }

  async setHueAndSaturation(hue: number, saturation: number): Promise<void> {
    await this.client.set('lb/0/hu', hue);
    await this.client.set('lb/0/sa', saturation);
  }

  async setColorTemperature(cct: number): Promise<void> {
    return this.client.set('lb/0/ct', cct);
  }

  async identify(): Promise<void> {
    return this.client.identify();
  }

  close(): void {
    this.client.close();
  }
}

export type { NL55State };
