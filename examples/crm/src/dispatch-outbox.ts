import { dispatchOutboxEvents } from "@framekit/jobs";
import { runtime, seedDemo } from "./app.js";

const tenant = {
  tenantId: "default",
  userId: "worker",
  roles: ["administrator"],
  permissions: ["*"]
};

await seedDemo();

const result = await dispatchOutboxEvents(runtime, tenant, async (event) => {
  console.log(JSON.stringify({ dispatched: event.id, type: event.type, topic: event.topic }));
});

console.log(JSON.stringify(result));
