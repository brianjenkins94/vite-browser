import { __root } from "../util/env";
import { spawn } from "child_process";

console.log(">", ["npx", "vite", "build"].join(" "))
let process = spawn("npx", ["vite", "build"], {
    "cwd": __root,
    "shell": true,
    //"stdio": "inherit"
});

await new Promise<void>(function recurse(resolve, reject) {
    const buffer = [];

    process.stderr.on("data", function(chunk) {
        buffer.push(chunk);
    });

    process.on("close", async function(code) {
        if (code === 0) {
            resolve();

            return;
        }

        const stderr = Buffer.concat(buffer).toString()

        const [packageName] = /(?<=\[vite\]: Rollup failed to resolve import ").*?(?=")/u.exec(stderr) ?? [];

        if (packageName === undefined) {
            console.error(stderr);

            reject();

            return;
        }

        console.log(">", ["npm", "install", "--ignore-scripts", "--save-peer", packageName + "@latest"].join(" "))
        const subprocess = spawn("npm", ["install", "--ignore-scripts", "--save-peer", packageName + "@latest"], {
            "cwd": __root,
            "shell": true,
            "stdio": "inherit"
        });

        await new Promise(function(resolve, reject) {
            subprocess.on("close", resolve);
        });

        console.log(">", ["npx", "vite", "build"].join(" "))
        process = spawn("npx", ["vite", "build"], {
            "cwd": __root,
            "shell": true,
            //"stdio": "inherit"
        });

        recurse(resolve, reject);
    })
});
