module.exports = {
  preset: 'react-native',
  testMatch: ['**/__tests__/**/*.test.ts'],
  setupFiles: ['<rootDir>/__tests__/setup.ts'],
  // CortexJS est livré en UMD : on le charge tel quel, sans transformation
  transformIgnorePatterns: ['node_modules/(?!(react-native|@react-native|lucide-react-native)/)'],
};
