/**
 * The app's identity. The ONLY place any of it is written — screens, copy, the Expo
 * config (app/app.config.ts) and the support link read it from here, so renaming the app
 * means editing this file and nothing else.
 *
 * BUNDLE_ID must be final before the first TestFlight upload: App Store Connect never
 * lets an app's bundle identifier change.
 */
export const APP_NAME = "[App Name]";

/** Lowercase, no spaces. Used for the Expo slug and the deep-link scheme (appname://). */
export const APP_SLUG = "appname";

/** Reverse-DNS, unique on the App Store. */
export const BUNDLE_ID = "com.example.appname";

/** Where "Report a problem" sends mail. Placeholder until the app has a real domain. */
export const SUPPORT_EMAIL = "support@example.com";
