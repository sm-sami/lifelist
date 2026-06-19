const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// pnpm hoisted monorepo: tell Metro where to find modules
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// Force a single copy of Skia — Expo Go already registers its native views,
// so a second bundle load causes "Tried to register two views with the same name".
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName === "@shopify/react-native-skia" ||
    moduleName.startsWith("@shopify/react-native-skia/")
  ) {
    return context.resolveRequest(
      { ...context, originModulePath: workspaceRoot },
      moduleName,
      platform,
    );
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
