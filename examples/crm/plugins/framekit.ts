import { definePlugin } from "nitro";
import { closeApplication } from "../src/app.js";

export default definePlugin((nitro) => {
  nitro.hooks.hook("close", closeApplication);
});
