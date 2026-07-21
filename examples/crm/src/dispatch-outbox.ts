import { OutboxDispatcher } from "@framekit/jobs";
import { runtime, seedDemo } from "./app.js";

const tenant = {
  tenantId: "default",
  userId: "worker",
  roles: ["administrator"],
  permissions: ["*"]
};

await seedDemo();

const dispatcher = new OutboxDispatcher(runtime, tenant, async (event, context) => {
  console.log(JSON.stringify({ dispatched: event.id, idempotencyKey: context.idempotencyKey, type: event.type, topic: event.topic }));
}, { ownerId: `crm-worker-${process.pid}`, maxAttempts: 5, baseBackoffMs: 1_000 });

try {
  console.log(JSON.stringify(await dispatcher.runOnce()));
} finally {
  await dispatcher.close();
}
