/**
 * Modules natifs remplacés pour Jest (pas de téléphone) : SQLite, llama.rn, fichiers, mémoire, réseau.
 */
jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => ({ execute: async () => ({ rows: [], insertId: 1 }) }),
}));
jest.mock('llama.rn', () => ({ initLlama: jest.fn() }));
jest.mock('react-native-fs', () => ({
  ExternalDirectoryPath: '/ext',
  DocumentDirectoryPath: '/doc',
  exists: async () => false,
}));
jest.mock('react-native-device-info', () => ({ getTotalMemory: async () => 8 * 1024 ** 3 }));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: () => () => {} }));
