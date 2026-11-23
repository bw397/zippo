import { serve } from "bun";
import index from "./index.html";

// The app is entirely client-side; this server only serves the bundle.
const server = serve({
  routes: {
    "/*": index,
  },

  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
