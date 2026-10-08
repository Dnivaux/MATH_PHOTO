module.exports = {
  preset: 'react-native',
  testMatch: ['**/__tests__/**/*.test.ts'],
  // CortexJS est livré en UMD : on le charge tel quel, sans transformation
  transformIgnorePatterns: ['node_modules/(?!(react-native|@react-native)/)'],
};
