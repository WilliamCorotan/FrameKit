export const publicPackages = [
  { directory: "auth", name: "@framekit/auth" },
  { directory: "cli", name: "@framekit/cli" },
  { directory: "core", name: "@framekit/core" },
  { directory: "db", name: "@framekit/db" },
  { directory: "jobs", name: "@framekit/jobs" },
  { directory: "nitro", name: "@framekit/nitro" },
  { directory: "openapi", name: "@framekit/openapi" },
  { directory: "realtime", name: "@framekit/realtime" },
  { directory: "runtime", name: "@framekit/runtime" },
  { directory: "sdk", name: "@framekit/sdk" }
];

export const publicPackageDirectories = publicPackages.map(({ directory }) => directory);
