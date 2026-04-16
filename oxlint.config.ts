import { defineConfig } from "oxlint";

export default defineConfig({
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "#test/env",
            message: "Test helpers must not be imported from production code.",
          },
        ],
      },
    ],
    "unicorn/prefer-node-protocol": "error",
  },
  overrides: [
    {
      files: ["src/**/*.test.ts", "test/**/*.ts"],
      rules: {
        "no-restricted-imports": "off",
        "no-floating-promises": "off",
      },
    },
  ],
});
