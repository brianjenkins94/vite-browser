import path from 'path'
import type { Logger } from '../node/logger'
import type { Plugin } from '../node/plugin'
import {
  mergeAlias,
  mergeConfig,
  resolveBaseUrl,
  sortUserPlugins,
  InlineConfig,
  ResolvedConfig
} from '../node/config'
import { normalizePath } from '../node/utils'
import { resolveBuildOptions } from '../node/build'
import { CLIENT_ENTRY, DEFAULT_ASSETS_RE, ENV_ENTRY } from '../node/constants'
import { resolvePlugins } from './plugins'
import { resolveServerOptions } from './server'
import { PluginContainer } from '../node'
import aliasPlugin from '@rollup/plugin-alias'
import { resolvePlugin } from './plugins/resolve'
import { createPluginContainer } from '../node/server/pluginContainer'

export async function resolveConfig(
  inlineConfig: InlineConfig,
  command: 'build' | 'serve',
  defaultMode = 'development'
): Promise<ResolvedConfig> {
  let config = inlineConfig
  const mode = defaultMode
  const isProduction = false

  const configEnv = {
    mode,
    command
  }

  // Define logger
  const logger: Logger = {
    info: (s) => console.log(s),
    warn: (s) => console.log(s),
    error: (s) => console.log(s),
    clearScreen: () => {
      /* empty */
    },
    hasErrorLogged: () => false,
    hasWarned: false,
    warnOnce: (s) => console.warn(s)
  }

  // resolve plugins
  const rawUserPlugins = (config.plugins || []).flat().filter((p) => {
    if (!p) {
      return false
    } else if (!p.apply) {
      return true
    } else if (typeof p.apply === 'function') {
      return p.apply({ ...config, mode }, configEnv)
    } else {
      return p.apply === command
    }
  }) as Plugin[]
  const [prePlugins, normalPlugins, postPlugins] =
    sortUserPlugins(rawUserPlugins)

  // run config hooks
  const userPlugins = [...prePlugins, ...normalPlugins, ...postPlugins]
  for (const p of userPlugins) {
    if (p.config) {
      const res = await p.config(config, configEnv)
      if (res) {
        config = mergeConfig(config, res)
      }
    }
  }

  // resolve root
  const resolvedRoot = normalizePath(
    config.root ? path.resolve(config.root) : process.cwd()
  )

  const clientAlias = [
    { find: /^[\/]?@vite\/env/, replacement: () => ENV_ENTRY },
    { find: /^[\/]?@vite\/client/, replacement: () => CLIENT_ENTRY }
  ]

  // resolve alias with internal client alias
  const resolvedAlias = mergeAlias(
    // @ts-ignore because @rollup/plugin-alias' type doesn't allow function
    // replacement, but its implementation does work with function values.
    clientAlias,
    config.resolve?.alias || config.alias || []
  )

  const resolveOptions: ResolvedConfig['resolve'] = {
    dedupe: config.dedupe,
    ...config.resolve,
    alias: resolvedAlias
  }

  // resolve public base url
  const BASE_URL = resolveBaseUrl(config.base, command === 'build', logger)
  const resolvedBuildOptions = resolveBuildOptions(resolvedRoot, config.build)

  const cacheDir = config.cacheDir

  // create an internal resolver to be used in special scenarios, e.g.
  // optimizer & handling css @imports
  const createResolver: ResolvedConfig['createResolver'] = (options) => {
    let aliasContainer: PluginContainer | undefined
    let resolverContainer: PluginContainer | undefined
    const createAliasPlugin = () =>
      aliasPlugin({
        entries: resolved.resolve.alias,
        customResolver: function (this, updatedId, importer) {
          return this.resolve(updatedId, importer, { skipSelf: true })
        }
      })
    return async (id, importer, aliasOnly, ssr) => {
      let container: PluginContainer
      if (aliasOnly) {
        container =
          aliasContainer ||
          (aliasContainer = await createPluginContainer({
            ...resolved,
            plugins: [createAliasPlugin()]
          }))
      } else {
        container =
          resolverContainer ||
          (resolverContainer = await createPluginContainer({
            ...resolved,
            plugins: [
              createAliasPlugin(),
              resolvePlugin({
                ...resolved.resolve,
                root: resolvedRoot,
                isProduction,
                isBuild: command === 'build',
                ssrConfig: resolved.ssr,
                asSrc: true,
                preferRelative: false,
                tryIndex: true,
                ...options
              })
            ]
          }))
      }
      return (await container.resolveId(id, importer, { ssr }))?.id
    }
  }

  const { publicDir } = config
  const resolvedPublicDir =
    publicDir !== false && publicDir !== ''
      ? path.resolve(
          resolvedRoot,
          typeof publicDir === 'string' ? publicDir : 'public'
        )
      : ''

  const server = resolveServerOptions(resolvedRoot, config.server)

  const resolved: ResolvedConfig = {
    ...config,
    configFile: undefined as any,
    configFileDependencies: [],
    inlineConfig,
    root: resolvedRoot,
    base: BASE_URL,
    resolve: resolveOptions,
    publicDir: resolvedPublicDir,
    cacheDir,
    command,
    mode,
    isProduction,
    plugins: userPlugins,
    server,
    build: resolvedBuildOptions,
    preview: undefined as any,
    env: {
      BASE_URL,
      MODE: mode,
      DEV: !isProduction,
      PROD: isProduction
    },
    assetsInclude(file: string) {
      return DEFAULT_ASSETS_RE.test(file)
    },
    logger,
    packageCache: new Map(),
    createResolver,
    optimizeDeps: {
      ...config.optimizeDeps,
      esbuildOptions: {
        keepNames: config.optimizeDeps?.keepNames,
        preserveSymlinks: config.resolve?.preserveSymlinks,
        ...config.optimizeDeps?.esbuildOptions
      }
    }
  }

  ;(resolved.plugins as Plugin[]) = await resolvePlugins(
    resolved,
    prePlugins,
    normalPlugins,
    postPlugins
  )

  // call configResolved hooks
  await Promise.all(userPlugins.map((p) => p.configResolved?.(resolved)))

  return resolved
}
