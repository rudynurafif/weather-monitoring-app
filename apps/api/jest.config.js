/**
 * Unit test dijalankan terhadap logika murni (konversi rain counter, validasi
 * rentang, dedup, kalibrasi) tanpa menyentuh database. Karena itu tidak ada
 * setup container atau koneksi apa pun di sini.
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['src/**/*.ts'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
};
