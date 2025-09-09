import { resolvePlugin } from './resolve'
import aliasPlugin from '@rollup/plugin-alias'
import type { ResolvedConfig } from '../../node/config'
import type { Plugin } from '../../node/plugin'
import { preAliasPlugin } from './preAlias'
import { htmlInlineScriptProxyPlugin } from '../../node/plugins/html'
import { cssPlugin, cssPostPlugin } from '../../node/plugins/css'
import { esbuildPlugin } from '../../node/plugins/esbuild'
import { jsonPlugin } from '../../node/plugins/json'
import { assetPlugin } from '../../node/plugins/asset'
import { definePlugin } from '../../node/plugins/define'
import { clientInjectionsPlugin } from '../../node/plugins/clientInjections'
import { importAnalysisPlugin } from '../../node/plugins/importAnalysis'

export async function resolvePlugins(
  config: ResolvedConfig,
  prePlugins: Plugin[],
  normalPlugins: Plugin[],
  postPlugins: Plugin[]
): Promise<Plugin[]> {
  const isBuild = config.command === 'build'

  const buildPlugins = { pre: [], post: [] }

  return [
    isBuild ? null : preAliasPlugin(),
    aliasPlugin({
      entries: config.resolve.alias,
      customResolver: function (this, updatedId, importer) {
        return this.resolve(updatedId, importer, { skipSelf: true })
      }
    }),
    ...prePlugins,
    // config.build.polyfillModulePreload
    //   ? modulePreloadPolyfillPlugin(config)
    //   : null,
    resolvePlugin({
      ...config.resolve,
      root: config.root,
      isProduction: config.isProduction,
      isBuild,
      packageCache: config.packageCache,
      ssrConfig: config.ssr,
      asSrc: true
    }),
    // config.build.ssr ? ssrRequireHookPlugin(config) : null,
    htmlInlineScriptProxyPlugin(config),
    cssPlugin(config),
    config.esbuild !== false ? esbuildPlugin(config.esbuild) : null,
    jsonPlugin(
      {
        namedExports: true,
        ...config.json
      },
      isBuild
    ),
    // wasmPlugin(config),
    // webWorkerPlugin(config),
    assetPlugin(config),
    ...normalPlugins,
    definePlugin(config),
    cssPostPlugin(config),
    ...buildPlugins.pre,
    ...postPlugins,
    ...buildPlugins.post,
    // internal server-only plugins are always applied after everything else
    ...(isBuild
      ? []
      : [clientInjectionsPlugin(config), importAnalysisPlugin(config)])
  ].filter(Boolean) as Plugin[]
}
