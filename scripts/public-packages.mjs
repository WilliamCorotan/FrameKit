export const publicPackages = [
  { directory: "core", name: "@framekit/core" },
  { directory: "realtime", name: "@framekit/realtime" },
  { directory: "auth", name: "@framekit/auth" },
  { directory: "openapi", name: "@framekit/openapi" },
  { directory: "runtime", name: "@framekit/runtime" },
  { directory: "db", name: "@framekit/db" },
  { directory: "jobs", name: "@framekit/jobs" },
  { directory: "sdk", name: "@framekit/sdk" },
  { directory: "nitro", name: "@framekit/nitro" },
  { directory: "cli", name: "@framekit/cli" }
];

export const publicPackageDirectories = publicPackages.map(({ directory }) => directory);
