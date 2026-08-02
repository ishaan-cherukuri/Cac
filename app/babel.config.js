module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
    // react-native-reanimated's plugin must be last. NativeWind and expo-router both
    // rely on it being present, and a missing/misordered plugin fails at runtime with
    // errors that point nowhere near the real cause.
    plugins: ["react-native-worklets/plugin"],
  };
};
