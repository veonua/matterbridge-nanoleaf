/**
 * @file src/device.ts
 * @description Protocol-independent Nanoleaf light device contract.
 * @license Apache-2.0
 */

export type NanoleafLightState = {
  on: boolean;
  brightness: number;
  hue: number;
  saturation: number;
  cct: number;
  colorTemperatureMinKelvin?: number;
  colorTemperatureMaxKelvin?: number;
};

export type NanoleafDeviceInfo = {
  serialNumber?: string;
  hardwareVersion?: string;
  firmwareVersion?: string;
};

/** A Nanoleaf device announced through mDNS. */
export type NanoleafDiscovery = {
  id: string;
  name: string;
  host: string;
  port: number;
  protocol: 'wifi-openapi' | 'ltpdu';
  model?: string;
  txt: Record<string, string>;
};

/** Common device operations used by the Matterbridge endpoint. */
export interface NanoleafLightDevice {
  readonly host: string;
  connect(): Promise<void>;
  state(): Promise<NanoleafLightState>;
  deviceInfo?(): Promise<NanoleafDeviceInfo>;
  setPower(on: boolean): Promise<void>;
  setBrightness(value: number): Promise<void>;
  setHueAndSaturation(hue: number, saturation: number): Promise<void>;
  setColorTemperature(cct: number): Promise<void>;
  identify(): Promise<void>;
  close(): void;
}
