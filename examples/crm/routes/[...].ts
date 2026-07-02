import { createNitroHandler } from "@framekit/nitro";
import { auth, runtime, seedDemo } from "../src/app.js";

await seedDemo();

export default createNitroHandler(runtime, { auth });
