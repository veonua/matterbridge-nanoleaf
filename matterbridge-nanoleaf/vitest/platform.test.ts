import type { PlatformConfig, PlatformMatterbridge } from 'matterbridge';
import { ColorControl, LevelControl } from 'matterbridge/matter/clusters';
import { log, setupTest } from 'matterbridge/vitest-utils';
import { addMatterbridge, createServerNode, createTestEnvironment, destroyTestEnvironment, flushServerNode, getMatterbridge } from 'matterbridge/vitest-utils/matter';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type MockDevice = {
  host: string;
  connect: ReturnType<typeof vi.fn>;
  state: ReturnType<typeof vi.fn>;
  deviceInfo: ReturnType<typeof vi.fn>;
  setPower: ReturnType<typeof vi.fn>;
  setBrightness: ReturnType<typeof vi.fn>;
  setHueAndSaturation: ReturnType<typeof vi.fn>;
  setColorTemperature: ReturnType<typeof vi.fn>;
  identify: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => ({
  discover: vi.fn(),
  ltpduClients: [] as Array<{ pair: ReturnType<typeof vi.fn> }>,
  ltpduDevices: [] as MockDevice[],
  wifiDevices: [] as Array<MockDevice & { pair: ReturnType<typeof vi.fn> }>,
  LtpduClient: vi.fn(),
  LtpduDevice: vi.fn(),
  WiFiPanelDevice: vi.fn(),
}));

function createMockDevice(): MockDevice {
  return {
    host: 'mock-host',
    connect: vi.fn().mockResolvedValue({}),
    state: vi.fn().mockResolvedValue({ on: true, brightness: 72, hue: 180, saturation: 55, cct: 2700 }),
    deviceInfo: vi.fn().mockResolvedValue({ serialNumber: 'serial-1', hardwareVersion: '1.0', firmwareVersion: '1.0' }),
    setPower: vi.fn().mockResolvedValue({}),
    setBrightness: vi.fn().mockResolvedValue({}),
    setHueAndSaturation: vi.fn().mockResolvedValue({}),
    setColorTemperature: vi.fn().mockResolvedValue({}),
    identify: vi.fn().mockResolvedValue({}),
    close: vi.fn(),
  };
}

vi.mock('../src/mdns-discovery.js', () => ({ discoverNanoleafMdns: mocks.discover }));
vi.mock('../src/ltpdu.js', () => ({ LtpduClient: mocks.LtpduClient }));
vi.mock('../src/ltpdu-device.js', () => ({ LtpduDevice: mocks.LtpduDevice }));
vi.mock('../src/wifi-panel.js', () => ({ WiFiPanelDevice: mocks.WiFiPanelDevice }));

import { NanoleafPlatform } from '../src/module.js';

await setupTest('NanoleafPlatform', false);

describe('Nanoleaf platform', () => {
  let matterbridge: PlatformMatterbridge;

  beforeAll(async () => {
    await createTestEnvironment();
    await createServerNode(6101);
    matterbridge = getMatterbridge();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.discover.mockResolvedValue([]);
    mocks.ltpduClients.length = 0;
    mocks.ltpduDevices.length = 0;
    mocks.wifiDevices.length = 0;
    mocks.LtpduClient.mockImplementation(function MockLtpduClient() {
      const client = { pair: vi.fn().mockResolvedValue('ltpdu-token') };
      mocks.ltpduClients.push(client);
      return client;
    });
    mocks.LtpduDevice.mockImplementation(function MockLtpduDevice(_client: unknown, host: string) {
      const device = createMockDevice();
      if (host === 'offline.local') device.state.mockRejectedValueOnce(new Error('offline'));
      mocks.ltpduDevices.push(device);
      return device;
    });
    mocks.WiFiPanelDevice.mockImplementation(function MockWiFiPanelDevice() {
      const device = { ...createMockDevice(), pair: vi.fn().mockResolvedValue('wifi-token') };
      mocks.wifiDevices.push(device);
      return device;
    });
  });

  afterAll(async () => {
    await flushServerNode();
    await destroyTestEnvironment();
    vi.restoreAllMocks();
  });

  it('starts LTPDU and Wi-Fi devices, saves generated tokens, and routes Matter commands', async () => {
    const config: PlatformConfig = {
      name: 'matterbridge-nanoleaf',
      type: 'AccessoryPlatform',
      version: '0.1.0',
      debug: false,
      unregisterOnShutdown: true,
      devices: [
        { protocol: 'ltpdu', host: 'strip.local', pin: '12345678', deviceName: 'Kitchen Strip' },
        { protocol: 'wifi-openapi', host: '192.168.1.20', deviceName: 'Living Room Panels' },
      ],
    };
    const platform = new NanoleafPlatform(matterbridge, log, config);
    addMatterbridge(platform);

    await platform.onStart('test');

    expect(platform.lights).toHaveLength(2);
    expect(mocks.ltpduClients[0]?.pair).toHaveBeenCalledWith('12345678');
    expect(mocks.wifiDevices[0]?.pair).toHaveBeenCalledOnce();
    expect((config.devices as PlatformConfig[])[0]?.token).toBe('ltpdu-token');
    expect((config.devices as PlatformConfig[])[1]?.token).toBe('wifi-token');

    const ltpduLight = platform.lights[0];
    await ltpduLight?.executeCommandHandler('on', {}, 'onOff', {} as never, ltpduLight);
    await ltpduLight?.executeCommandHandler(
      'LevelControl.step',
      { stepMode: LevelControl.StepMode.Up, stepSize: 25, transitionTime: 0, optionsMask: {}, optionsOverride: {} },
      'levelControl',
      { currentLevel: 127, minLevel: 1, maxLevel: 254 } as never,
      ltpduLight,
    );
    await ltpduLight?.executeCommandHandler(
      'ColorControl.stepColorTemperature',
      {
        stepMode: ColorControl.StepMode.Up,
        stepSize: 20,
        transitionTime: 0,
        colorTemperatureMinimumMireds: 200,
        colorTemperatureMaximumMireds: 500,
        optionsMask: {},
        optionsOverride: {},
      },
      'colorControl',
      { colorTemperatureMireds: 370, colorTempPhysicalMinMireds: 147, colorTempPhysicalMaxMireds: 500 } as never,
      ltpduLight,
    );
    await ltpduLight?.executeCommandHandler('moveToLevel', { level: 127 } as never, 'levelControl', {} as never, ltpduLight);
    await ltpduLight?.executeCommandHandler('moveToHueAndSaturation', { hue: 127, saturation: 127 } as never, 'colorControl', {} as never, ltpduLight);
    await ltpduLight?.executeCommandHandler('moveToColorTemperature', { colorTemperatureMireds: 370 } as never, 'colorControl', {} as never, ltpduLight);

    expect(mocks.ltpduDevices[0]?.setPower).toHaveBeenCalledWith(true);
    expect(mocks.ltpduDevices[0]?.setBrightness).toHaveBeenCalledWith(60);
    expect(mocks.ltpduDevices[0]?.setBrightness).toHaveBeenCalledWith(50);
    expect(mocks.ltpduDevices[0]?.setHueAndSaturation).toHaveBeenCalledWith(180, 50);
    expect(mocks.ltpduDevices[0]?.setColorTemperature).toHaveBeenCalledWith(2703);
    expect(mocks.ltpduDevices[0]?.setColorTemperature).toHaveBeenCalledWith(2564);

    await platform.onConfigure();
    expect(mocks.ltpduDevices[0]?.state).toHaveBeenCalledTimes(4);
    expect(mocks.wifiDevices[0]?.state).toHaveBeenCalledTimes(2);
    await platform.onShutdown();
    expect(mocks.ltpduDevices[0]?.close).toHaveBeenCalledOnce();
    expect(mocks.wifiDevices[0]?.close).toHaveBeenCalledOnce();
  });

  it('does not send a color-temperature command while the Nanoleaf is off', async () => {
    const config: PlatformConfig = {
      name: 'off-temperature',
      type: 'AccessoryPlatform',
      version: '0.1.0',
      debug: false,
      unregisterOnShutdown: true,
      devices: [{ protocol: 'wifi-openapi', host: '192.168.1.20', deviceName: 'Panels' }],
    };
    const platform = new NanoleafPlatform(matterbridge, log, config);
    addMatterbridge(platform);
    await platform.onStart();

    const device = mocks.wifiDevices[0];
    device?.state.mockResolvedValue({ on: false, brightness: 72, hue: 180, saturation: 55, cct: 2700 });
    await platform.lights[0]?.executeCommandHandler('moveToColorTemperature', { colorTemperatureMireds: 370 } as never, 'colorControl', {} as never, platform.lights[0]);
    expect(device?.setColorTemperature).not.toHaveBeenCalled();

    device?.state.mockResolvedValue({ on: true, brightness: 72, hue: 180, saturation: 55, cct: 2700 });
    await platform.lights[0]?.executeCommandHandler('moveToColorTemperature', { colorTemperatureMireds: 370 } as never, 'colorControl', {} as never, platform.lights[0]);
    expect(device?.setColorTemperature).toHaveBeenCalledWith(2703);

    await platform.onShutdown();
  });

  it('continues when a configured device is offline', async () => {
    const offlineConfig: PlatformConfig = {
      name: 'offline',
      type: 'AccessoryPlatform',
      version: '0.1.0',
      debug: false,
      unregisterOnShutdown: true,
      devices: [
        { protocol: 'ltpdu', host: 'offline.local', token: '0123456789abcdef' },
        { protocol: 'wifi-openapi', host: '192.168.1.20', token: 'wifi-token' },
      ],
    };
    const offline = new NanoleafPlatform(matterbridge, log, offlineConfig);
    addMatterbridge(offline);
    await offline.onStart();
    expect(offline.lights).toHaveLength(1);
    expect(mocks.ltpduDevices[0]?.close).toHaveBeenCalledOnce();
    expect(mocks.wifiDevices[0]?.state).toHaveBeenCalledOnce();
    expect(mocks.WiFiPanelDevice).toHaveBeenCalledWith('192.168.1.20', 16021, 'wifi-token');
    await offline.onShutdown();
  });

  it('lists discovered devices without attempting to pair them', async () => {
    mocks.discover.mockResolvedValue([{ id: 'wifi-1', name: 'Panels', host: '192.168.1.20', port: 16021, protocol: 'wifi-openapi', txt: {} }]);
    const config: PlatformConfig = {
      name: 'discovery',
      type: 'AccessoryPlatform',
      version: '0.1.0',
      debug: false,
      unregisterOnShutdown: true,
      devices: [{ protocol: 'ltpdu', host: 'strip.local', token: '0123456789abcdef' }],
    };
    const platform = new NanoleafPlatform(matterbridge, log, config);
    addMatterbridge(platform);

    await platform.onStart();

    expect(mocks.discover).toHaveBeenCalledWith(1500, undefined);
    expect(mocks.WiFiPanelDevice).not.toHaveBeenCalled();
    await platform.onShutdown();
  });
});
