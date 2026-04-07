const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, '../packages/shared');

const config = getDefaultConfig(projectRoot);

// Watch the shared package for changes
config.watchFolders = [sharedRoot];

// Resolve @ironsight/shared to the source directory
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  '@ironsight/shared': path.resolve(sharedRoot, 'src'),
};

// Ensure Metro resolves node_modules from the mobile project
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
];

module.exports = config;
