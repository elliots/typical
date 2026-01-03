// monkeypatch fs.readFileSync to automatically add @elliots/typical-tsc-plugin to tsconfig.json (if not present)

const fs = require('fs')
const stripJsonComments = require('strip-json-comments').default

const origFsReadFileSync = fs.readFileSync

fs.readFileSync = function (path, ...args) {
  const result = origFsReadFileSync.call(this, path, ...args)

  if (typeof path === 'string' && path.endsWith('/tsconfig.json')) {
    try {
      const json = stripJsonComments(result.toString(), { trailingCommas: true })

      const config = JSON.parse(json)

      if (!config.compilerOptions) {
        config.compilerOptions = {}
      }

      if (!config.compilerOptions.plugins) {
        config.compilerOptions.plugins = []
      }

      const hasTypical = config.compilerOptions.plugins.some(plugin => plugin.transform === '@elliots/typical-tsc-plugin' || plugin.transform === '@elliots/typical/tsc-plugin')

      if (!hasTypical) {
        config.compilerOptions.plugins.push({
          transform: '@elliots/typical-tsc-plugin',
          transformProgram: true,
        })
      }

      return JSON.stringify(config, null, 2)
    } catch (e) {
      console.error('ERROR patching tsconfig.json to add @elliots/typical-tsc-plugin', e)
      throw e
    }
  }
  return result
}
