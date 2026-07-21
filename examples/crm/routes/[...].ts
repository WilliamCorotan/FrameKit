import { createNitroHandler } from "@framekit/nitro";
import { auth, runtime, seedDemo } from "../src/app.js";

await seedDemo();

const production = process.env.NODE_ENV === "production";
const configuredOrigins = process.env.FRAMEKIT_ALLOWED_ORIGINS
  ?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = configuredOrigins?.length
  ? configuredOrigins
  : production
    ? []
    : ["http://localhost:5173", "http://127.0.0.1:5173"];
const sameSite = cookieSameSite(process.env.FRAMEKIT_COOKIE_SAME_SITE);

export default createNitroHandler(runtime, {
  auth,
  cors: { origins: allowedOrigins, credentials: true },
  authCookie: { secure: production, sameSite },
  security: {
    trustedOrigins: allowedOrigins,
    trustProxy: process.env.FRAMEKIT_TRUST_PROXY === "true"
  }
});

function cookieSameSite(value: string | undefined): "lax" | "strict" | "none" {
  if (!value || value === "lax") {
    return "lax";
  }
  if (value === "strict" || value === "none") {
    return value;
  }
  throw new Error("FRAMEKIT_COOKIE_SAME_SITE must be lax, strict, or none.");
}
