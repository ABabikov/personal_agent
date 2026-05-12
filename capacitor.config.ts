import type { CapacitorConfig } from "@capacitor/cli";

/**
 * WebView грузит удалённый Next (production или dev).
 * Android emulator: http://10.0.2.2:3000 → localhost хоста.
 * Устройство в той же Wi‑Fi: http://<IP-ПК>:3000
 */
const serverUrl = process.env.CAPACITOR_SERVER_URL?.trim();

const config: CapacitorConfig = {
  appId: "com.personalagent.app",
  appName: "Personal Agent",
  webDir: "www",
  ...(serverUrl
    ? {
        server: {
          url: serverUrl,
          cleartext: serverUrl.startsWith("http://"),
        },
      }
    : {}),
};

export default config;
