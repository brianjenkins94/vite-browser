import { defineConfig } from "vite";

export default defineConfig({
    "build": {
        "rollupOptions": {
            "input": {
                "env": "vite/src/client/env.ts",
                "client": "vite/src/client/client.ts",
                "browser": "vite/src/node/index.ts",
                //"node": "vite/src/node/index.ts",
                "cli": "vite/src/node/cli.ts"
            },
            "external": [
                "#module-sync-enabled",
                "lightningcss",
                "./fsevents.node"
            ]
        }
    }
});