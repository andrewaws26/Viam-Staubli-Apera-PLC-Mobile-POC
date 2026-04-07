/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  moduleNameMapper: {
    "^@ironsight/shared/(.*)$": "<rootDir>/../packages/shared/src/$1",
    "^@ironsight/shared$": "<rootDir>/../packages/shared/src/index",
    "^@/(.*)$": "<rootDir>/src/$1",
  },
};
