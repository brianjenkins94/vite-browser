import * as path from "path";
import * as fs from "../../fs";
import stdLibBrowser from "node-stdlib-browser";
import { PluginOption } from "vite";
import * as url from "url";

const extendedStdLibBrowser = {
    ...stdLibBrowser,
    "node:inspector": "empty.js",
    "inspector": "empty.js",
    "node:perf_hooks": "empty.js",
    "perf_hooks": "empty.js",
    "node:v8": "empty.js",
    "v8": "empty.js",
    "node:worker_threads": "empty.js",
    "worker_threads": "empty.js"
};

// TODO: Improve
export async function findParentPackageJson(directory) {
	if (fs.existsSync(path.join(directory, "package.json"))) {
		return path.join(directory, "package.json");
	} else {
		return findParentPackageJson(path.dirname(directory));
	}
}

export function virtualFileSystem(files = {}) {
    let __root;

    let external;

    function shouldBeExternal(id) {
        return new RegExp(`^(${external.join("|")})(/.*)?$`).test(id);
    }

    function isBuiltin(id) {
        return new RegExp(`^(${Object.keys(extendedStdLibBrowser).join("|")})(/.*)?$`).test(id);
    }

    return {
        "name": "virtual-file-system",
        "enforce": "pre",
        "configResolved": async function(config) {
            __root = config.root;

            files = Object.entries(files).reduce((files, [fileName, value]) => {
                files[path.join(__root, fileName)] = value;

                return files;
            }, {});

            external = config.build.rollupOptions.external;

            if (external === undefined) {
                // TODO: Improve
                const packageJson = JSON.parse(await fs.readFile(await findParentPackageJson(__root)));

                external = Object.keys(packageJson["dependencies"])
            }
        },
        "resolveId": async function(id, importer, options) {
            if (id.includes("?") || importer === undefined) {
                return;
            }

            if (Object.keys(files).includes(path.join(__root, id))) {
                return path.join(__root, id);
            }

            let resolveId = id;

            if (shouldBeExternal(id)) {
                console.log(id);
            }

            if (!isBuiltin(id.split("/")[0])) {
                resolveId = (await this.resolve(id, importer, options))["id"];
            }

            return resolveId;
        },
        "load": async function(id) {
            if (id.includes("?")) {
                return;
            }

            if (files[id] !== undefined) {
                let code = files[id]

                if (!path.extname(id).endsWith(".html") && Array.isArray(external)) {
                    code = code.replace(new RegExp(`(?!['"])(?!['"]$).*?(?<!\\/\\* @__PURE__ \\*\\/ )\\b(${external.join("|")})\\b(?!['"])`, "gu"), function(line, match) {
                        return line.startsWith("import") ? line : line.replace(match, "/* @__PURE__ */ " + match)
                    });
                }

                return {
                    "code": code,
                    "moduleSideEffects": false
                };
            }

            id = id.replace(path.join(__root, "/").replace(/\\/gu, "/"), "");

            if (shouldBeExternal(id)) {
                console.log(id);
            }

            if (isBuiltin(id)) {
                const code = Object.entries(await import(id)).map(function([key, value]) {
                    return `export ${key === "default" ? "default" : `const ${key} =`} ${(typeof value === "function" ? "() => {}" : undefined)};`;
                }).join("\n");

                return {
                    "code": code,
                    "moduleSideEffects": false
                };
            }
        }
    } as PluginOption;
}
