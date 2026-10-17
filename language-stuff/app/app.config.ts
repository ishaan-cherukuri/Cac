import type { ConfigContext, ExpoConfig } from "expo/config";
import { APP_NAME, APP_SLUG, BUNDLE_ID } from "../packages/core/src/brand.ts";

/**
 * Everything static lives in app.json. This file injects the app's identity from
 * packages/core/src/brand.ts, so the home-screen name, the bundle id and the in-app
 * name cannot drift apart.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: APP_NAME,
  slug: APP_SLUG,
  scheme: APP_SLUG,
  ios: {
    ...config.ios,
    bundleIdentifier: BUNDLE_ID,
    infoPlist: {
      ...config.ios?.infoPlist,
      NSMicrophoneUsageDescription: `${APP_NAME} needs your microphone so your grandmother can hear you speak.`,
      NSLocalNetworkUsageDescription: `${APP_NAME} connects to the development server on your local network.`,
    },
  },
  android: {
    ...config.android,
    package: BUNDLE_ID,
  },
});
