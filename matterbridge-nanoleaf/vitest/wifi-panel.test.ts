import { WiFiPanelDevice } from '../src/wifi-panel.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

test('pairs and reads state through the Wi-Fi OpenAPI', async () => {
  const fetchMock = vi.fn<typeof fetch>();
  fetchMock
    .mockResolvedValueOnce(new Response(JSON.stringify({ auth_token: 'wifi-token' }), { status: 200 }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ on: { value: true }, brightness: { value: 72 }, hue: { value: 180 }, sat: { value: 55 }, ct: { value: 2700 } }), { status: 200 }),
    );
  vi.stubGlobal('fetch', fetchMock);

  const device = new WiFiPanelDevice('192.168.1.10', 16021, '');
  await device.pair();
  await expect(device.state()).resolves.toEqual({ on: true, brightness: 72, hue: 180, saturation: 55, cct: 2700 });
  expect(fetchMock.mock.calls[0]?.[0]).toBe('http://192.168.1.10:16021/api/v1/new');
  expect(fetchMock.mock.calls[1]?.[0]).toBe('http://192.168.1.10:16021/api/v1/wifi-token/state');
});

test('sends OpenAPI requests for every supported light command', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);

  const device = new WiFiPanelDevice('192.168.1.10', 16021, 'wifi-token');
  await device.setPower(true);
  await device.setBrightness(72);
  await device.setHueAndSaturation(180, 55);
  await device.setColorTemperature(2700);
  await device.identify();

  expect(fetchMock.mock.calls).toEqual([
    ['http://192.168.1.10:16021/api/v1/wifi-token/state', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ on: { value: true } }) })],
    ['http://192.168.1.10:16021/api/v1/wifi-token/state', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ brightness: { value: 72 } }) })],
    ['http://192.168.1.10:16021/api/v1/wifi-token/state', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ hue: { value: 180 }, sat: { value: 55 } }) })],
    ['http://192.168.1.10:16021/api/v1/wifi-token/state', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ ct: { value: 2700 } }) })],
    ['http://192.168.1.10:16021/api/v1/wifi-token/identify', expect.objectContaining({ method: 'PUT' })],
  ]);
});

test('reports an OpenAPI response failure', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 })));

  const device = new WiFiPanelDevice('192.168.1.10', 16021, 'expired-token');
  await expect(device.state()).rejects.toThrow('Nanoleaf Wi-Fi GET state failed with HTTP 401');
});
