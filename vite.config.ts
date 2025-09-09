import { defineConfig } from "vite";
import { polyfillNode } from "./util/vite/plugins/polyfillNode";
import { virtualFileSystem } from "./util/vite/plugins/virtualFileSystem";

export default defineConfig({
    "define": {
        "performance": "Date"
    },
    "build": {
        "rollupOptions": {
            "input": {
                "env": "vite/src/client/env.ts",
                "client": "vite/src/client/client.ts",
                "browser": "vite/src/node/index.ts",
                //"node": "vite/src/node/index.ts",
                "cli": "vite/src/node/cli.ts",
                //"module-runner": "vite/src/module-runner/index.ts"
            },
            "output": {
                "entryFileNames": "[name].js",
            }
        },
        "minify": false,
        "modulePreload": { "polyfill": false }
    },
    "plugins": [
        polyfillNode(),
        virtualFileSystem()
    ]
});
