const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// Drizzle migration .sql dosyalarını import edebilmek için
config.resolver.sourceExts.push('sql');

module.exports = withNativeWind(config, { input: './global.css' });
