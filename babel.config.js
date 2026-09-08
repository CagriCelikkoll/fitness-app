module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    plugins: [
      // Drizzle'ın .sql migration dosyalarını JS'e inline import edebilmesi için gerekli
      ['inline-import', { extensions: ['.sql'] }],
      // Reanimated 4 worklets plugin'i — MUTLAKA SON OLMALI
      'react-native-worklets/plugin',
    ],
  };
};
