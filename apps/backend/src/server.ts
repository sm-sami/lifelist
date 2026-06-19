import { serve } from "@hono/node-server";
import app from "./index";

const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port });
console.log(`[dev] Lifelist backend listening on http://localhost:${port}`);
