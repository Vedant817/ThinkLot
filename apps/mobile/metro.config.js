const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");
const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, "../../src")];
// Shared backend bindings resolve the mobile runtime, including a single React.
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];
const defaults = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(defaults) ? defaults : defaults ? [defaults] : []),
  // Native compiler output has no JS sources and can overwhelm Metro's crawler.
  /[\\/](?:\.cxx|\.gradle|\.kotlin)[\\/]/,
  /[\\/]android[\\/](?:build|app[\\/]build)[\\/]/,
];
module.exports = config;
