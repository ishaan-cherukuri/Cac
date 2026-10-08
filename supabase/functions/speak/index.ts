/**
 * GET /functions/v1/speak — production wiring. The logic lives in handler.ts.
 */

import { createSpeakHandler } from "./handler.ts";

Deno.serve(createSpeakHandler({ env: (name) => Deno.env.get(name), fetch }));
