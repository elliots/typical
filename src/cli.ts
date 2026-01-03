#!/usr/bin/env node

import { Command } from 'commander'
import * as fs from 'fs'
import * as path from 'path'
import { TypicalTransformer } from './transformer.js'
import { loadConfig, validateConfig } from './config.js'
import { inlineSourceMapComment, externalSourceMapComment } from './source-map.js'

const program = new Command()

program.name('typical').description('Runtime safe TypeScript transformer using typia').version('0.1.0')

program
  .command('transform')
  .description('Transform a TypeScript file with runtime validation')
  .argument('<file>', 'TypeScript file to transform')
  .option('-o, --output <file>', 'Output file')
  .option('-c, --config <file>', 'Config file path', 'typical.json')
  .option('-m, --mode <mode>', 'Transformation mode:  basic, typia, js', 'basic')
  .option('--source-map', 'Generate external source map file')
  .option('--inline-source-map', 'Include inline source map in output')
  .option('--no-source-map', 'Disable source map generation')
  .action(
    async (
      file: string,
      options: {
        output?: string
        config?: string
        mode?: 'basic' | 'typia' | 'js'
        sourceMap?: boolean
        inlineSourceMap?: boolean
      },
    ) => {
      try {
        const config = validateConfig(loadConfig(options.config))
        const transformer = new TypicalTransformer(config)

        if (!fs.existsSync(file)) {
          console.error(`File not found: ${file}`)
          process.exit(1)
        }

        // Determine source map behavior
        const generateSourceMap = options.inlineSourceMap || options.sourceMap !== false

        console.log(`Transforming ${file}...`)
        const result = transformer.transform(path.resolve(file), options.mode ?? 'basic', {
          sourceMap: generateSourceMap,
        })

        // Determine output file path
        const outputFile = options.output ? path.resolve(options.output) : options.mode === 'js' ? file.replace(/\.tsx?$/, '.js') : file + '.transformed.ts'

        let outputCode = result.code

        // Handle source maps
        if (result.map) {
          if (options.inlineSourceMap) {
            // Inline source map as data URL
            outputCode += '\n' + inlineSourceMapComment(result.map)
          } else if (options.sourceMap !== false) {
            // Write external source map file
            const mapFile = outputFile + '.map'
            fs.writeFileSync(mapFile, JSON.stringify(result.map, null, 2))
            outputCode += '\n' + externalSourceMapComment(path.basename(mapFile))
            console.log(`Source map written to ${mapFile}`)
          }
        }

        fs.writeFileSync(outputFile, outputCode)
        console.log(`Transformed code written to ${outputFile}`)
      } catch (error) {
        console.error('Transformation failed:', error)
        process.exit(1)
      }
    },
  )

// program
//   .command('build')
//   .description('Transform all TypeScript files in the project')
//   .option('-c, --config <file>', 'Config file path')
//   .option('--dry-run', 'Show what would be transformed without making changes')
//   .action(async (options: { config?: string, dryRun?: boolean }) => {
//     try {
//       const transformer = new TypicalTransformer();

//       const { glob } = await import('glob');

//       const config = loadConfig(options.config);

//       if (!config.include || config.include.length === 0) {
//         console.error('No include patterns specified in config');
//         process.exit(1);
//       }

//       const files: string[] = [];

//       for (const pattern of config.include) {
//         const matched = await glob(pattern, {
//           ignore: config.exclude,
//           absolute: true
//         });
//         files.push(...matched);
//       }

//       console.log(`Found ${files.length} files to transform`);

//       if (options.dryRun) {
//         files.forEach(file => console.log(`Would transform: ${file}`));
//         return;
//       }

//       let transformed = 0;

//       for (const file of files) {
//         // Double-check with our shared filtering logic
//         if (!shouldIncludeFile(file, config)) {
//           console.log(`Skipping ${file} (excluded by filters)`);
//           continue;
//         }

//         try {
//           console.log(`Transforming ${file}...`);
//           const transformedCode = transformer.transformFile(file, ts);
//           fs.writeFileSync(file, transformedCode);
//           transformed++;
//         } catch (error) {
//           console.error(`Failed to transform ${file}:`, error);
//         }
//       }

//       console.log(`Successfully transformed ${transformed}/${files.length} files`);
//     } catch (error) {
//       console.error('Build failed:', error);
//       process.exit(1);
//     }
//   });

program.parse()
