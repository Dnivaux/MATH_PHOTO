module.exports = {
  root: true,
  extends: '@react-native',
  ignorePatterns: ['android/', 'ios/', 'scripts/engine-harness/engine-bundle.js', 'node_modules/'],
  rules: {
    'react-native/no-inline-styles': 'off',
  },
};
