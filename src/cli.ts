#!/usr/bin/env node

import { Command } from 'commander'
import * as fs from 'fs'
import * as path from 'path'
import { TypicalTransformer } from './transformer.js'
import { loadConfig, validateConfig } from './config.js'

const program = new Command()

program.name('typical').description('Runtime safe TypeScript transformer').version('0.1.0')

program
  .command('transform')
  .description('Transform a TypeScript file with runtime validation')
  .argument('<file>', 'TypeScript file to transform')
  .option('-o, --output <file>', 'Output file')
  .option('-c, --config <file>', 'Config file path', 'typical.json')
  .option('-p, --project <file>', 'TypeScript config file path', 'tsconfig.json')
  .action(
    async (
      file: string,
      options: {
        output?: string
        config?: string
        project?: string
      },
    ) => {
      let transformer: TypicalTransformer | null = null
      try {
        const config = validateConfig(loadConfig(options.config))
        transformer = new TypicalTransformer(config, options.project)

        if (!fs.existsSync(file)) {
          console.error(`File not found: ${file}`)
          process.exit(1)
        }

        console.log(`Transforming ${file}...`)
        const result = await transformer.transform(path.resolve(file), 'ts')

        // Determine output file path
        const outputFile = options.output ? path.resolve(options.output) : file + '.transformed.ts'

        fs.writeFileSync(outputFile, result.code)
        console.log(`Transformed code written to ${outputFile}`)
      } catch (error) {
        console.error('Transformation failed:', error)
        process.exit(1)
      } finally {
        if (transformer) {
          await transformer.close()
        }
      }
    },
  )

program.parse()
