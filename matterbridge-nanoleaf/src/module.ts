/**
 * @file src/module.ts
 * @description Matterbridge accessory platform for Nanoleaf devices.
 * @license Apache-2.0
 */

import { extendedColorLight, MatterbridgeAccessoryPlatform, MatterbridgeEndpoint, powerSource, type PlatformConfig, type PlatformMatterbridge } from 'matterbridge';
import type { AnsiLogger } from 'matterbridge/logger';

import type { NanoleafLightDevice, NanoleafLightState } from './device.js';
import { LtpduDevice } from './ltpdu-device.js';
import { LtpduClient } from './ltpdu.js';
import { discoverNanoleafMdns } from './mdns-discovery.js';
import { WiFiPanelDevice } from './wifi-panel.js';

type NanoleafProtocol = 'wifi-openapi' | 'ltpdu';
type NanoleafTarget = {
  host: string;
  port: number;
  protocol: NanoleafProtocol;
  model?: string;
  deviceName?: string;
  token?: string;
  pin?: string;
  configEntry: PlatformConfig;
};

function stringConfig(config: PlatformConfig, key: string): string | undefined {
  const value = config[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberConfig(config: PlatformConfig, key: string, fallback: number): number {
  const value = config[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function booleanConfig(config: PlatformConfig, key: string, fallback: boolean): boolean {
  const value = config[key];
  return typeof value === 'boolean' ? value : fallback;
}

function pinConfig(config: PlatformConfig): string | undefined {
  const pin = stringConfig(config, 'pin')?.replace(/[- ]/g, '');
  return pin && /^[0-9]{8}$/.test(pin) ? pin : undefined;
}

function scale(value: number, from: number, to: number): number {
  return Math.round((value / from) * to);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function stepValue(value: number, stepSize: number, stepMode: number, minimum: number, maximum: number, upMode: number): number {
  const direction = stepMode === upMode ? 1 : -1;
  return clamp(value + direction * stepSize, minimum, maximum);
}

function protocolConfig(config: PlatformConfig): NanoleafProtocol {
  return stringConfig(config, 'protocol') === 'wifi-openapi' ? 'wifi-openapi' : 'ltpdu';
}

function portForProtocol(protocol: NanoleafProtocol): number {
  return protocol === 'wifi-openapi' ? 16021 : 5683;
}

function isPlatformConfig(value: unknown): value is PlatformConfig {
  return typeof value === 'object' && value !== null;
}

export default function initializePlugin(matterbridge: PlatformMatterbridge, log: AnsiLogger, config: PlatformConfig): NanoleafPlatform {
  return new NanoleafPlatform(matterbridge, log, config);
}

export class NanoleafPlatform extends MatterbridgeAccessoryPlatform {
  lights: MatterbridgeEndpoint[] = [];
  devices: NanoleafLightDevice[] = [];
  private pollTimer?: NodeJS.Timeout;
  constructor(matterbridge: PlatformMatterbridge, log: AnsiLogger, config: PlatformConfig) {
    super(matterbridge, log, config);
    if (typeof this.verifyMatterbridgeVersion !== 'function' || !this.verifyMatterbridgeVersion('3.10.0')) {
      throw new Error(`This plugin requires Matterbridge version >= "3.10.0". Please update Matterbridge from ${this.matterbridge.matterbridgeVersion}.`);
    }
    this.log.info('Initializing Nanoleaf platform:', this.config.name);
  }

  override async onStart(reason?: string): Promise<void> {
    await this.ready;
    await this.logDiscoveredDevices();
    const targets = this.resolveTargets();
    for (const target of targets) {
      try {
        await this.startTarget(target, reason);
      } catch (error) {
        this.log.warn('Nanoleaf target unavailable:', target.host, error instanceof Error ? error.message : String(error));
      }
    }
    if (this.lights.length === 0) throw new Error('No Nanoleaf devices could be connected.');
  }

  private async logDiscoveredDevices(): Promise<void> {
    if (!booleanConfig(this.config, 'discover', true)) return;
    try {
      const devices = await discoverNanoleafMdns(numberConfig(this.config, 'mdnsTimeout', 1500), stringConfig(this.config, 'mdnsInterface'));
      if (devices.length === 0) {
        this.log.info('Nanoleaf mDNS discovery found no supported devices.');
        return;
      }
      const configuration = devices.map(({ host, name, protocol }) =>
        protocol === 'ltpdu'
          ? { protocol: 'ltpdu', host, deviceName: name, pin: '<enter 8-digit PIN>' }
          : { protocol: 'wifi-openapi', host, deviceName: name, token: '<optional existing token>' },
      );
      this.log.info('Nanoleaf mDNS discovery found:', JSON.stringify(devices.map(({ id, name, host, port, protocol, model }) => ({ id, name, host, port, protocol, model }))));
      this.log.info('Add the devices to configure to "devices" and enter the requested PIN or token:', JSON.stringify(configuration));
    } catch (error) {
      this.log.warn('Nanoleaf mDNS discovery failed:', error instanceof Error ? error.message : String(error));
    }
  }

  private async startTarget(target: NanoleafTarget, reason?: string): Promise<void> {
    let device: NanoleafLightDevice | undefined;
    try {
      device = await this.createDevice(target);
      const state = await device.state();
      const info = await device.deviceInfo?.();
      const name = target.deviceName ?? target.model ?? (target.protocol === 'ltpdu' ? 'Nanoleaf Essentials' : 'Nanoleaf Wi-Fi Panel');
      const light = new MatterbridgeEndpoint([extendedColorLight, powerSource], { id: `${name}-${target.host}` }, this.config.debug)
        .createDefaultIdentifyClusterServer()
        .createDefaultBasicInformationClusterServer(
          name,
          info?.serialNumber ?? target.host,
          0xfff1,
          'Nanoleaf',
          0x0001,
          target.model ?? name,
          1,
          '0.1.0',
          1,
          this.matterbridge.matterbridgeVersion,
        )
        .createDefaultOnOffClusterServer(state.on)
        .createDefaultLevelControlClusterServer(scale(state.brightness, 100, 254), 1, 254)
        .createDefaultColorControlClusterServer(0, 0, scale(state.hue, 360, 254), scale(state.saturation, 100, 254), state.cct > 0 ? Math.round(1_000_000 / state.cct) : 500)
        .createDefaultPowerSourceWiredClusterServer()
        .addRequiredClusters();
      await this.registerDevice(light);
      this.devices.push(device);
      this.lights.push(light);
      this.registerCommandHandlers(light, device);
      device = undefined;
      this.log.info('Nanoleaf connected:', target.protocol, target.host, reason ?? 'none');
    } catch (error) {
      device?.close();
      throw error;
    }
  }

  private async createDevice(target: NanoleafTarget): Promise<NanoleafLightDevice> {
    if (target.protocol === 'ltpdu') {
      const client = new LtpduClient(target.host, target.port, target.token ?? '');
      const device = new LtpduDevice(client, target.host);
      try {
        if (!target.token) {
          if (!target.pin) throw new Error(`Nanoleaf LTPDU device at ${target.host} requires an 8-digit PIN when no token is stored.`);
          const token = await client.pair(target.pin);
          target.token = token;
          target.configEntry.token = token;
          this.saveConfig(this.config);
          this.log.info('Nanoleaf LTPDU pairing completed and token saved.');
        }
        return device;
      } catch (error) {
        client.close();
        throw error;
      }
    }
    const client = new WiFiPanelDevice(target.host, target.port, target.token ?? '');
    if (!target.token) {
      const token = await client.pair();
      target.token = token;
      target.configEntry.token = token;
      this.saveConfig(this.config);
      this.log.info('Nanoleaf Wi-Fi OpenAPI pairing completed and token saved.');
    }
    return client;
  }

  private resolveTargets(): NanoleafTarget[] {
    const configuredDevices = this.config.devices;
    if (!Array.isArray(configuredDevices) || configuredDevices.length === 0) {
      throw new Error('Nanoleaf requires at least one configured device in the devices array.');
    }
    return configuredDevices.flatMap((value): NanoleafTarget[] => {
      if (!isPlatformConfig(value)) return [];
      const config = value;
      const host = stringConfig(config, 'host');
      if (!host) return [];
      const protocol = protocolConfig(config);
      return [
        {
          host,
          port: portForProtocol(protocol),
          protocol,
          model: stringConfig(config, 'model'),
          deviceName: stringConfig(config, 'deviceName'),
          token: stringConfig(config, 'token'),
          pin: pinConfig(config),
          configEntry: config,
        },
      ];
    });
  }

  private registerCommandHandlers(light: MatterbridgeEndpoint, device: NanoleafLightDevice): void {
    light.addCommandHandler('identify', async () => device.identify());
    light.addCommandHandler('on', async () => device.setPower(true));
    light.addCommandHandler('off', async () => device.setPower(false));
    light.addCommandHandler('LevelControl.step', async ({ request: { stepMode, stepSize }, attributes: { currentLevel, minLevel, maxLevel } }) =>
      device.setBrightness(scale(stepValue(currentLevel ?? 1, stepSize, stepMode, minLevel ?? 1, maxLevel ?? 254, 0), 254, 100)),
    );
    light.addCommandHandler('LevelControl.stepWithOnOff', async ({ request: { stepMode, stepSize }, attributes: { currentLevel, minLevel, maxLevel } }) => {
      const minimum = minLevel ?? 1;
      const target = stepValue(currentLevel ?? minimum, stepSize, stepMode, minimum, maxLevel ?? 254, 0);
      await device.setBrightness(scale(target, 254, 100));
      await device.setPower(target > minimum);
    });
    light.addCommandHandler('moveToLevel', async ({ request: { level } }) => device.setBrightness(scale(level, 254, 100)));
    light.addCommandHandler('moveToLevelWithOnOff', async ({ request: { level } }) => device.setBrightness(scale(level, 254, 100)));
    light.addCommandHandler('moveToHueAndSaturation', async ({ request: { hue, saturation } }) => device.setHueAndSaturation(scale(hue, 254, 360), scale(saturation, 254, 100)));
    light.addCommandHandler('moveToColorTemperature', async ({ request: { colorTemperatureMireds } }) =>
      this.setColorTemperatureIfOn(device, Math.round(1_000_000 / colorTemperatureMireds)),
    );
    light.addCommandHandler(
      'stepColorTemperature',
      async ({
        request: { stepMode, stepSize, colorTemperatureMinimumMireds, colorTemperatureMaximumMireds },
        attributes: { colorTemperatureMireds, colorTempPhysicalMinMireds, colorTempPhysicalMaxMireds },
      }) => {
        const minimum = colorTemperatureMinimumMireds || colorTempPhysicalMinMireds;
        const maximum = colorTemperatureMaximumMireds || colorTempPhysicalMaxMireds;
        const targetMireds = stepValue(colorTemperatureMireds, stepSize, stepMode, minimum, maximum, 1);
        await this.setColorTemperatureIfOn(device, Math.round(1_000_000 / targetMireds));
      },
    );
  }

  private async setColorTemperatureIfOn(device: NanoleafLightDevice, cct: number): Promise<void> {
    const state = await device.state();
    if (!state.on) {
      this.log.info('Nanoleaf color-temperature command skipped because the device is off:', device.host);
      return;
    }
    await device.setColorTemperature(cct);
  }

  override async onConfigure(): Promise<void> {
    await super.onConfigure();
    await this.poll();
    clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => void this.poll(), numberConfig(this.config, 'pollInterval', 30_000));
  }

  private async poll(): Promise<void> {
    await Promise.all(
      this.devices.map(async (device, index) => {
        const light = this.lights[index];
        if (!light) return;
        try {
          await this.applyState(light, await device.state());
        } catch (error) {
          this.log.warn('Nanoleaf state poll failed:', error instanceof Error ? error.message : String(error));
        }
      }),
    );
  }

  private async applyState(light: MatterbridgeEndpoint, state: NanoleafLightState): Promise<void> {
    await light.setAttribute('OnOff', 'onOff', state.on, this.log);
    await light.setAttribute('LevelControl', 'currentLevel', scale(state.brightness, 100, 254), this.log);
    await light.setAttribute('ColorControl', 'currentHue', scale(state.hue, 360, 254), this.log);
    await light.setAttribute('ColorControl', 'currentSaturation', scale(state.saturation, 100, 254), this.log);
    if (state.cct > 0) await light.setAttribute('ColorControl', 'colorTemperatureMireds', Math.round(1_000_000 / state.cct), this.log);
  }

  override async onShutdown(reason?: string): Promise<void> {
    clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    for (const device of this.devices) device.close();
    this.devices = [];
    this.lights = [];
    await super.onShutdown(reason);
    if (this.config.unregisterOnShutdown) await this.unregisterAllDevices();
  }
}
