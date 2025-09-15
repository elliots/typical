#!/usr/bin/env node

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { TypicalTransformer } from './transformer.js';
import * as ts from 'typescript';
import { loadConfig } from './config.js';
import { shouldIncludeFile } from './file-filter.js';

const program = new Command();

program
  .name('typical')
  .description('Runtime safe TypeScript transformer using typia')
  .version('0.1.0');

program
  .command('transform')
  .description('Transform a TypeScript file with runtime validation')
  .argument('<file>', 'TypeScript file to transform')
  .option('-o, --output <file>', 'Output file')
  .option('-c, --config <file>', 'Config file path', 'typical.json')
  .option('-m, --mode <mode>', 'Transformation mode:  basic, typia, js', 'basic')
  .action(async (file: string, options: { output?: string; config?: string; mode?: 'basic' | 'typia' | 'js' }) => {
    try {
      const config = loadConfig(options.config);
      const transformer = new TypicalTransformer(config);
      
      if (!fs.existsSync(file)) {
        console.error(`File not found: ${file}`);
        process.exit(1);
      }

      console.log(`Transforming ${file}...`);
      const transformedCode = transformer.transform(path.resolve(file), options.mode ?? 'basic');

      const outputFilename = options.output ? path.resolve(options.output) : options.mode === 'js' ? file + '.js' : file + '.transformed.ts';
      
      const outputFile = options.output ? path.resolve(options.output) : file + '.transformed.ts';
      fs.writeFileSync(outputFile, transformedCode);
      
      console.log(`Transformed code written to ${outputFile}`);
    } catch (error) {
      console.error('Transformation failed:', error);
      process.exit(1);
    }
  });

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

program.parse();