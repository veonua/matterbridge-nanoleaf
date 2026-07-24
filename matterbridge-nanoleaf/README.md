# Matterbridge Nanoleaf

Matterbridge plugin for local control of supported Nanoleaf lights. It exposes the lights as Matter extended-colour lights, so they can be used by Matter controllers such as Apple Home, Google Home, Alexa, SmartThings, and Home Assistant.

## Supported devices and transports

| Device family                         | Transport      | Connection                          |
| ------------------------------------- | -------------- | ----------------------------------- |
| Nanoleaf Essentials devices           | Thread / LTPDU | Encrypted CoAP over UDP port `5683` |
| Nanoleaf Wi-Fi panels, including NL22 | OpenAPI        | HTTP API, normally port `16021`     |

At startup, the plugin can list all supported Nanoleaf devices announced through mDNS: Wi-Fi OpenAPI (`_nanoleafapi._tcp.local`) and Thread/LTPDU (`_ltpdu._udp.local`). Discovery only lists devices; add each device you want to control to `devices` and enter its PIN or token in Matterbridge configuration. The port is selected automatically from the protocol: `5683` for LTPDU and `16021` for Wi-Fi OpenAPI.

## Install

```sh
npm install matterbridge-nanoleaf
matterbridge --add matterbridge-nanoleaf
```

## Configuration

Configure devices explicitly in the `devices` array. Tokens and PINs are secrets: do not commit or share them.

Set `discover` to `false` to skip the mDNS scan, or use `mdnsTimeout` and `mdnsInterface` when the default network scan needs adjustment.

### Devices

```json
{
  "devices": [
    {
      "protocol": "ltpdu",
      "host": "Nanoleaf-Strip-AFTE.local",
      "pin": "12345678",
      "deviceName": "Kitchen Strip"
    },
    {
      "protocol": "wifi-openapi",
      "host": "192.168.1.20",
      "deviceName": "Living Room Panels"
    }
  ],
  "pollInterval": 30000
}
```

Each configured device is started independently. If one is offline, the plugin logs a warning and continues with the others. If no configured device can be connected, startup fails. For LTPDU devices, Matterbridge displays the eight-digit `pin` field on first setup; the resulting access token is saved as `token` in that device entry. For Wi-Fi panels, open the device pairing window if required; the plugin obtains and saves its token on first connection.

## Matter controls

Every connected light provides:

- on and off
- brightness, including relative `Step` and `StepWithOnOff` changes
- hue and saturation
- colour temperature, including relative `StepColorTemperature` changes
- Matter Identify
- periodic state refresh (`pollInterval`, default 30 seconds)

The plugin currently supports lights only. Scene management and automatic configuration of discovered devices are not implemented.

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
