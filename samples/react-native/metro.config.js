// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require("@expo/metro-config");
const { withTypical } = require("@elliots/metro-transformer-typical");

const config = getDefaultConfig(__dirname);

module.exports = withTypical(config, {
  typical: {
    validateCasts: true,
  },
});
