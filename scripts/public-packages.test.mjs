import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { publicPackages } from "./public-packages.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

describe("public package catalog", () => {
  it("contains every public package exactly once in dependency-safe publish order", async () => {
    const directories = (await readdir(join(root, "packages"), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const manifests = await Promise.all(
      directories.map(async (directory) => ({
        directory,
        manifest: JSON.parse(await readFile(join(root, "packages", directory, "package.json"), "utf8"))
      }))
    );
    const expected = manifests.filter(({ manifest }) => !manifest.private);
    const positions = new Map(publicPackages.map(({ directory }, index) => [directory, index]));

    expect(new Set(publicPackages.map(({ directory }) => directory)).size).toBe(publicPackages.length);
    expect([...positions.keys()].sort()).toEqual(expected.map(({ directory }) => directory).sort());

    for (const { directory, manifest } of expected) {
      expect(publicPackages[positions.get(directory)]?.name).toBe(manifest.name);
      const dependencies = { ...manifest.dependencies, ...manifest.peerDependencies };
      for (const dependency of Object.keys(dependencies).filter((name) => name.startsWith("@framekit/"))) {
        const dependencyPosition = publicPackages.findIndex(({ name }) => name === dependency);
        expect(dependencyPosition, `${manifest.name} depends on uncatalogued ${dependency}`).toBeGreaterThanOrEqual(0);
        expect(dependencyPosition, `${dependency} must publish before ${manifest.name}`).toBeLessThan(positions.get(directory));
      }
    }
  });
});
