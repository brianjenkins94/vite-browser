import * as path from "path";
import * as fs from "./util/fs";
import { defineConfig } from "vite";
import { polyfillNode } from "./util/vite/plugins/polyfillNode";
import { virtualFileSystem } from "./util/vite/plugins/virtualFileSystem";
import { __root } from "./util/env";

const packageJson = JSON.parse(await fs.readFile(path.join(__root, "package.json")));

export default defineConfig({
    "base": "/vite-browser/",
    "resolve": {
        "alias": [
            {
                "find": /^vite(?!\/src)(.*)$/u,
                "replacement": path.join(__root, "vite", "src",  "$1")
            }
        ]
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
                // ---
                "main": "src/main.ts",
                "vite/sw": "src/vite/sw.ts",
                "vite/worker": "src/vite/worker.ts",
            },
            "output": {
                "entryFileNames": "[name].js",
            },
            "external": [
                "fsevents",
                "lightningcss",
                "rollup/parseAst",
                /^#/u,
                ...Object.keys(packageJson["dependencies"] ?? {})
            ]
        },
        "minify": false,
        "modulePreload": { "polyfill": false }
    },
    "plugins": [
        virtualFileSystem()
    ]
});
