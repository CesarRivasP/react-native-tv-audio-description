/** @type {import('jest').Config} */
module.exports = {
  preset: 'react-native',
  testRegex: '/test/.*\\.(test|spec)\\.(ts|tsx)$',
  moduleNameMapper: {
    // The real package reaches a native TurboModule that exists only on a Vega
    // device; importing it under jest throws before any assertion runs.
    '^@amazon-devices/react-native-w3cmedia$': '<rootDir>/test/mocks/w3cmedia.tsx',
  },
};
