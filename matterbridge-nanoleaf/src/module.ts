/**
 * @file src/module.ts
 * @description Matterbridge accessory platform for Nanoleaf devices.
 * @license Apache-2.0
 */

import { extendedColorLight, MatterbridgeAccessoryPlatform, MatterbridgeEndpoint, powerSource, type PlatformConfig, type PlatformMatterbridge } from 'matterbridge';
import type { AnsiLogger } from 'matterbridge/logger';

import type { NanoleafLightDevice, NanoleafLightState } from './device.js';
import { discoverNanoleafMdns } from './mdns-discovery.js';
import { NL55Device } from './nl55-device.js';
import { NL55Client } from './nl55.js';
import { WiFiPanelDevice } from './wifi-panel.js';

type NanoleafProtocol = 'wifi-openapi' | 'thread-ltpdu';
type NanoleafTarget = {
  host: string;
  port: number;
  protocol: NanoleafProtocol;
  model?: string;
  deviceName?: string;
  token?: string;
  pin?: string;
  id?: string;
  configBacked?: boolean;
  configEntry?: PlatformConfig;
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
  return stringConfig(config, 'protocol') === 'wifi-openapi' ? 'wifi-openapi' : 'thread-ltpdu';
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
  private pairedHost?: string;
  private pairedPin?: string;

  constructor(matterbridge: PlatformMatterbridge, log: AnsiLogger, config: PlatformConfig) {
    super(matterbridge, log, config);
    if (typeof this.verifyMatterbridgeVersion !== 'function' || !this.verifyMatterbridgeVersion('3.10.0')) {
      throw new Error(`This plugin requires Matterbridge version >= "3.10.0". Please update Matterbridge from ${this.matterbridge.matterbridgeVersion}.`);
    }
    this.log.info('Initializing Nanoleaf platform:', this.config.name);
  }

  override async onStart(reason?: string): Promise<void> {
    await this.ready;
    const targets = await this.resolveTargets();
    for (const target of targets) {
      try {
        await this.startTarget(target, reason);
      } catch (error) {
        this.log.warn('Nanoleaf target unavailable:', target.host, error instanceof Error ? error.message : String(error));
      }
    }
    if (this.lights.length === 0) throw new Error('No Nanoleaf devices could be connected.');
  }

  private async startTarget(target: NanoleafTarget, reason?: string): Promise<void> {
    const device = await this.createDevice(target);
    const state = await device.state();
    const info = await device.deviceInfo?.();
    const name = target.deviceName ?? target.model ?? (target.protocol === 'thread-ltpdu' ? 'Nanoleaf NL55' : 'Nanoleaf Wi-Fi Panel');
    const light = new MatterbridgeEndpoint([extendedColorLight, powerSource], { id: `${name}-${target.id ?? target.host}` }, this.config.debug)
      .createDefaultIdentifyClusterServer()
      .createDefaultBasicInformationClusterServer(
        name,
        info?.serialNumber ?? target.id ?? target.host,
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
    this.log.info('Nanoleaf connected:', target.protocol, target.host, reason ?? 'none');
  }

  private async createDevice(target: NanoleafTarget): Promise<NanoleafLightDevice> {
    if (target.protocol === 'thread-ltpdu') {
      const client = new NL55Client(target.host, target.port, target.token ?? '');
      const device = new NL55Device(client, target.host);
      if (!target.token) {
        if (!target.pin) throw new Error(`Nanoleaf NL55 at ${target.host} requires an 8-digit PIN when no token is stored.`);
        const token = await client.pair(target.pin);
        target.token = token;
        if (target.configBacked) {
          this.config.token = token;
          if (target.configEntry) target.configEntry.token = token;
          this.saveConfig(this.config);
        }
        this.log.info('Nanoleaf NL55 pairing completed and token saved.');
      }
      return device;
    }
    const client = new WiFiPanelDevice(target.host, target.port, target.token ?? '');
    if (!target.token) {
      const token = await client.pair();
      target.token = token;
      if (target.configBacked) {
        this.config.openApiToken = token;
        if (target.configEntry) target.configEntry.openApiToken = token;
        this.saveConfig(this.config);
      }
      this.log.info('Nanoleaf Wi-Fi OpenAPI pairing completed and token saved.');
    }
    return client;
  }

  private async resolveTargets(): Promise<NanoleafTarget[]> {
    const configuredDevices = this.config.devices;
    if (Array.isArray(configuredDevices) && configuredDevices.length > 0) {
      return configuredDevices.flatMap((value): NanoleafTarget[] => {
        if (!isPlatformConfig(value)) return [];
        const config = value;
        const host = stringConfig(config, 'host');
        if (!host) return [];
        const protocol = protocolConfig(config);
        return [
          {
            host,
            port: numberConfig(config, 'port', protocol === 'wifi-openapi' ? 16021 : 5683),
            protocol,
            model: stringConfig(config, 'model'),
            deviceName: stringConfig(config, 'deviceName'),
            token: stringConfig(config, protocol === 'wifi-openapi' ? 'openApiToken' : 'token'),
            pin: pinConfig(config),
            id: stringConfig(config, 'deviceId'),
            configBacked: true,
            configEntry: config,
          },
        ];
      });
    }
    const target = await this.resolveTarget();
    target.configBacked = true;
    return [target];
  }

  private async resolveTarget(): Promise<NanoleafTarget> {
    const configuredHost = stringConfig(this.config, 'host');
    if (configuredHost) {
      const protocol = protocolConfig(this.config);
      return {
        host: configuredHost,
        port: numberConfig(this.config, 'port', protocol === 'wifi-openapi' ? 16021 : 5683),
        protocol,
        model: stringConfig(this.config, 'model'),
        deviceName: stringConfig(this.config, 'deviceName'),
        token: stringConfig(this.config, protocol === 'wifi-openapi' ? 'openApiToken' : 'token'),
        pin: pinConfig(this.config),
        id: stringConfig(this.config, 'deviceId'),
      };
    }
    if (!booleanConfig(this.config, 'discover', true)) throw new Error('Nanoleaf requires a host when mDNS discovery is disabled.');
    const discovered = await discoverNanoleafMdns(numberConfig(this.config, 'mdnsTimeout', 1500), stringConfig(this.config, 'mdnsInterface'));
    const requestedId = stringConfig(this.config, 'deviceId');
    const requestedProtocol = stringConfig(this.config, 'protocol');
    const discoveryProtocol: NanoleafProtocol | undefined = requestedProtocol === 'wifi-openapi' ? 'wifi-openapi' : requestedProtocol === 'nl55-ltpdu' ? 'thread-ltpdu' : undefined;
    const candidates = discoveryProtocol ? discovered.filter((device) => device.protocol === discoveryProtocol) : discovered;
    const preferred = candidates.filter((device) => device.protocol === 'thread-ltpdu');
    const pool = preferred.length > 0 ? preferred : candidates;
    const selected = requestedId ? pool.find((device) => device.id === requestedId || device.name === requestedId) : pool[0];
    if (!selected) throw new Error(requestedId ? `Nanoleaf device not found for deviceId "${requestedId}".` : 'No Nanoleaf device found via mDNS.');
    this.log.info('Nanoleaf device discovered via mDNS:', selected.protocol, selected.name, selected.host);
    return {
      ...selected,
      port: selected.port,
      deviceName: stringConfig(this.config, 'deviceName'),
      token: stringConfig(this.config, selected.protocol === 'wifi-openapi' ? 'openApiToken' : 'token'),
      pin: pinConfig(this.config),
    };
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
      device.setColorTemperature(Math.round(1_000_000 / colorTemperatureMireds)),
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
        await device.setColorTemperature(Math.round(1_000_000 / targetMireds));
      },
    );
  }

  override async onConfigure(): Promise<void> {
    await super.onConfigure();
    await this.poll();
    this.pollTimer = setInterval(() => void this.poll(), numberConfig(this.config, 'pollInterval', 30_000));
  }

  override async onConfigChanged(config: PlatformConfig): Promise<void> {
    const host = stringConfig(config, 'host');
    const pin = pinConfig(config);
    if (this.pairedHost && (host !== this.pairedHost || pin !== this.pairedPin)) {
      delete config.token;
      delete config.openApiToken;
      this.log.info('Nanoleaf target or PIN changed; stored tokens will be refreshed on next start.');
      this.saveConfig(config);
    }
    await super.onConfigChanged(config);
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
