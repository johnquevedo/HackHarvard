export async function loadModule(name: string): Promise<Record<string, unknown> | null> {
  try {
    const importer = new Function("specifier", "return import(specifier)") as (
      specifier: string,
    ) => Promise<Record<string, unknown>>;
    return await importer(name);
  } catch {
    return null;
  }
}

const purchasing = await loadModule("@dennis/purchasing");
const shortme = await loadModule("@dennis/shortme");
const platform = await loadModule("@dennis/platform");
if (!purchasing || !shortme || !platform || typeof platform.createPlatform !== "function") {
  console.error("seed waits for platform, purchasing, and shortme modules.");
  process.exit(1);
}
const ctx = await (platform.createPlatform as () => Promise<unknown>)();
await (purchasing.purchasingModule as { seed: (value: unknown) => Promise<void> }).seed(ctx);
await (shortme.shortmeModule as { seed: (value: unknown) => Promise<void> }).seed(ctx);
console.log("seed finished");
