# Matterbridge Nanoleaf

Matterbridge plugin for local control of supported Nanoleaf lights. It exposes the lights as Matter extended-colour lights, so they can be used by Matter controllers such as Apple Home, Google Home, Alexa, SmartThings, and Home Assistant.

## Supported devices and transports

| Device family                         | Transport      | Connection                          |
| ------------------------------------- | -------------- | ----------------------------------- |
| Nanoleaf Essentials NL55 lightstrip   | Thread / LTPDU | Encrypted CoAP over UDP port `5683` |
| Nanoleaf Wi-Fi panels, including NL22 | OpenAPI        | HTTP API, normally port `16021`     |

The plugin discovers Nanoleaf devices with mDNS when `host` is omitted:

- Wi-Fi OpenAPI: `_nanoleafapi._tcp.local`
- Thread/LTPDU: `_ltpdu._udp.local` and `_hap._udp.local`

With `protocol: "auto"`, Thread/LTPDU devices are preferred when both types are discovered. Use `deviceId` or an explicit `host` to select a particular device.

## Install

```sh
npm install matterbridge-nanoleaf
matterbridge --add matterbridge-nanoleaf
```

## Configuration

Configure a single device directly, or add several explicit devices in `devices`. Tokens and PINs are secrets: do not commit or share them.

### NL55 (Thread / LTPDU)

On the first start provide the eight-digit Nanoleaf PIN. The plugin pairs with the light, saves the resulting LTPDU token in Matterbridge configuration, and uses that token thereafter.

```json
{
  "protocol": "nl55-ltpdu",
  "host": "Nanoleaf-Strip-AFTE.local",
  "pin": "12345678",
  "deviceName": "Kitchen Strip"
}
```

An IPv6 address may be used instead of the mDNS hostname. For later starts the stored `token` is used automatically.

### Wi-Fi panels (OpenAPI, including NL22)

```json
{
  "protocol": "wifi-openapi",
  "host": "192.168.1.20",
  "port": 16021,
  "deviceName": "Living Room Panels"
}
```

On first connection the plugin obtains and stores an OpenAPI token as `openApiToken` in Matterbridge configuration. Open the device's pairing window before its first connection if the panel requires it.

### Several explicit devices

```json
{
  "devices": [
    {
      "protocol": "nl55-ltpdu",
      "host": "Nanoleaf-Strip-AFTE.local",
      "pin": "12345678",
      "deviceName": "Kitchen Strip"
    },
    {
      "protocol": "wifi-openapi",
      "host": "192.168.1.20",
      "port": 16021,
      "deviceName": "Living Room Panels"
    }
  ],
  "pollInterval": 30000
}
```

Each configured device is started independently. If one is offline, the plugin logs a warning and continues with the others. If no configured or discovered device can be connected, startup fails.

## Matter controls

Every connected light provides:

- on and off
- brightness, including relative `Step` and `StepWithOnOff` changes
- hue and saturation
- colour temperature, including relative `StepColorTemperature` changes
- Matter Identify
- periodic state refresh (`pollInterval`, default 30 seconds)

The plugin currently supports lights only. Scene management and dynamic multi-device discovery are not yet implemented.

## Development

```sh
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
```

Live-device checks should use a local Matterbridge installation and a device-specific configuration. Never put a real PIN or token in tests, documentation, or logs.

## License

Apache-2.0. See [LICENSE](LICENSE).
