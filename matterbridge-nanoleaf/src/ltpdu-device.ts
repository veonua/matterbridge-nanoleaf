/**
 * @file src/ltpdu-device.ts
 * @description Nanoleaf LTPDU implementation of the common light device contract.
 * @license Apache-2.0
 */

import type { NanoleafLightDevice, NanoleafLightState } from './device.js';
import type { LtpduClient, LtpduDeviceInfo, LtpduState } from './ltpdu.js';

/** Adapt the pre-Matter Nanoleaf LTPDU client to the protocol-independent contract. */
export class LtpduDevice implements NanoleafLightDevice {
  readonly host: string;

  constructor(
    private readonly client: LtpduClient,
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

  async deviceInfo(): Promise<LtpduDeviceInfo> {
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

export type { LtpduState };
