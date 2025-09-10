import * as path from "path";
import * as fs from "../../fs";
import { PluginOption } from "vite";

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

                external = [
                    ...external,
                    ...Object.keys({
                        ...packageJson["dependencies"],
                        ...packageJson["peerDependencies"]
                    })
                ];
            }
        },
        "resolveId": async function(id, importer, options) {
            if (id.includes("?") || importer === undefined) {
                return;
            }

            if (Object.keys(files).includes(path.join(__root, id))) {
                return path.join(__root, id);
            }

            if (typeof external === "function") {
                return {
                    "id": id.startsWith(".") ? (await this.resolve(id, importer, options))["id"] : id,
                    "external": id.startsWith(".") ? false : external(id),
                    "moduleSideEffects": false
                };
            } else if (Array.isArray(external)) {
                function shouldBeExternal(id) {
                    return new RegExp(`^(${external.join("|")})(/.*)?$`).test(id);
                }

                let resolved = await this.resolve(id, importer, options);

                if (resolved === null) {
                    // TODO: Extract as fallback
                    resolved = await this.resolve(id.startsWith("vite/") ? path.join(__root, "vite", "src", id.substring("vite/".length)) : path.join(__root, "node_modules", id), importer, options);

                    if (resolved === null && !shouldBeExternal(id)) {
                        return;
                    }
                }

                return {
                    "id": id.startsWith(".") || !shouldBeExternal(id) ? resolved["id"] : id,
                    "external": id.startsWith(".") ? false : shouldBeExternal(id),
                    "moduleSideEffects": false
                };
            }
        },
        "load": async function(id) {
            if (id.includes("?")) {
                return;
            }

            if (files[id] !== undefined) {
                let result = files[id]

                if (!path.extname(id).endsWith(".html") && Array.isArray(external)) {
                    result = result.replace(new RegExp(`(?!['"])(?!['"]$).*?(?<!\\/\\* @__PURE__ \\*\\/ )\\b(${external.join("|")})\\b(?!['"])`, "gu"), function(line, match) {
                        return line.startsWith("import") ? line : line.replace(match, "/* @__PURE__ */ " + match)
                    });
                }

                return result;
            }
        }
    } as PluginOption;
}
