const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("node:path");

// Monorepo setup: the app lives in a workspace and imports @ammamma/core, whose source
// sits outside this directory. Metro only watches the project folder by default, so it
// needs both the workspace root in watchFolders and both node_modules locations, or
// shared imports resolve at typecheck time and fail at bundle time.
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// Prefer the hoisted copy so React and React Native are never duplicated — two copies of
// React in one bundle shows up as inscrutable hook errors.
config.resolver.disableHierarchicalLookup = true;

// If you hit "Unable to resolve module X" for a package that is definitely installed:
// check for a stale Metro process before touching this file. A long-lived `expo run:ios`
// holds port 8081, so `expo start` silently fails to bind and you keep testing against an
// old file map. `lsof -ti:8081` will show the owner — note that `pkill -f "expo start"`
// does NOT match a process whose command line is `expo run:ios`.
module.exports = withNativeWind(config, { input: "./global.css" });
