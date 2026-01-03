import { TypicalCompiler } from '../dist/index.js'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function main() {
  console.log('Starting e2e test...\n')

  const compiler = new TypicalCompiler({
    cwd: join(__dirname, 'fixtures'),
  })

  try {
    console.log('1. Starting compiler...')
    await compiler.start()
    console.log('   ✓ Compiler started\n')

    console.log('2. Loading project...')
    const project = await compiler.loadProject('tsconfig.json')
    console.log(`   ✓ Project loaded: ${project.id}`)
    console.log(`   Root files: ${project.rootFiles.join(', ')}\n`)

    console.log('3. Transforming sample.ts...')
    const result = await compiler.transformFile(project, 'sample.ts')
    console.log('   ✓ Transform complete\n')

    console.log('=== Transformed code ===')
    console.log(result.code)
    console.log('========================\n')

    console.log('=== Source Map ===')
    if (result.sourceMap) {
      console.log(JSON.stringify(result.sourceMap, null, 2))
    } else {
      console.log('(no source map)')
    }
    console.log('==================\n')

    // Write original and transformed files to test/output
    const outputDir = join(__dirname, 'output')
    mkdirSync(outputDir, { recursive: true })

    // Read original source
    const originalSource = readFileSync(join(__dirname, 'fixtures', 'sample.ts'), 'utf-8')
    writeFileSync(join(outputDir, 'sample.original.ts'), originalSource)
    console.log(`Written: ${join(outputDir, 'sample.original.ts')}`)

    // Write transformed code
    writeFileSync(join(outputDir, 'sample.transformed.ts'), result.code)
    console.log(`Written: ${join(outputDir, 'sample.transformed.ts')}`)

    // Write source map (update 'file' field to match actual output filename)
    if (result.sourceMap) {
      const mapWithCorrectFile = {
        ...result.sourceMap,
        file: 'sample.transformed.ts',
      }
      writeFileSync(join(outputDir, 'sample.transformed.ts.map'), JSON.stringify(mapWithCorrectFile, null, 2))
      console.log(`Written: ${join(outputDir, 'sample.transformed.ts.map')}`)
    }
    console.log('')

    // Verify validators were inserted
    const checks = {
      // Validator functions with name parameter: ((_v: any, _n: string) => { ...
      validatorFunctions: (result.code.match(/\(\(_v: any, _n: string\) => \{/g) || []).length,

      // Should have TypeError throws with meaningful messages
      typeErrors: (result.code.match(/throw new TypeError\("Expected " \+ _n/g) || []).length,

      // Should have typeof checks for primitives
      stringChecks: (result.code.match(/"string" === typeof/g) || []).length,
      numberChecks: (result.code.match(/"number" === typeof/g) || []).length,

      // Should have object checks
      objectChecks: (result.code.match(/"object" === typeof/g) || []).length,

      // Should have array checks
      arrayChecks: (result.code.match(/Array\.isArray/g) || []).length,

      // Should have null checks for union types
      nullChecks: (result.code.match(/null ===/g) || []).length,

      // Should have .then() for sync Promise returns
      thenCalls: (result.code.match(/\.then\(_v =>/g) || []).length,

      // Named parameters in validator calls like (value, "name")
      namedParams: (result.code.match(/\)\([^,]+, "[^"]+"\)/g) || []).length,
    }

    // Verify source map
    const sourceMapChecks = {
      hasSourceMap: !!result.sourceMap,
      hasVersion3: result.sourceMap?.version === 3,
      hasSources: (result.sourceMap?.sources?.length ?? 0) > 0,
      hasSourcesContent: (result.sourceMap?.sourcesContent?.length ?? 0) > 0,
      hasMappings: (result.sourceMap?.mappings?.length ?? 0) > 0,
    }

    console.log('Validator checks found:')
    console.log(`  - Validator functions: ${checks.validatorFunctions}`)
    console.log(`  - TypeError throws: ${checks.typeErrors}`)
    console.log(`  - String type checks: ${checks.stringChecks}`)
    console.log(`  - Number type checks: ${checks.numberChecks}`)
    console.log(`  - Object type checks: ${checks.objectChecks}`)
    console.log(`  - Array checks: ${checks.arrayChecks}`)
    console.log(`  - Null checks (unions): ${checks.nullChecks}`)
    console.log(`  - .then() for Promise: ${checks.thenCalls}`)
    console.log(`  - Named parameters: ${checks.namedParams}`)

    console.log('\nSource map checks:')
    console.log(`  - Has source map: ${sourceMapChecks.hasSourceMap}`)
    console.log(`  - Version 3: ${sourceMapChecks.hasVersion3}`)
    console.log(`  - Has sources: ${sourceMapChecks.hasSources}`)
    console.log(`  - Has sourcesContent: ${sourceMapChecks.hasSourcesContent}`)
    console.log(`  - Has mappings: ${sourceMapChecks.hasMappings}`)

    // Validate the output
    const errors: string[] = []

    if (checks.validatorFunctions === 0) {
      errors.push('No validator functions found - validation not working')
    }

    if (checks.typeErrors === 0) {
      errors.push('No TypeError throws found - error handling not working')
    }

    if (checks.stringChecks === 0) {
      errors.push('No string type checks found')
    }

    if (checks.numberChecks === 0) {
      errors.push('No number type checks found')
    }

    if (checks.objectChecks === 0) {
      errors.push('No object type checks found - User type not validated')
    }

    if (checks.arrayChecks === 0) {
      errors.push('No Array.isArray checks found - array parameter not validated')
    }

    if (checks.nullChecks === 0) {
      errors.push('No null checks found - union types not validated')
    }

    if (checks.thenCalls === 0) {
      errors.push('No .then() calls found - sync Promise return not handled')
    }

    if (checks.namedParams === 0) {
      errors.push("No named parameters found - error messages won't show variable names")
    }

    // Source map validation
    if (!sourceMapChecks.hasSourceMap) {
      errors.push('No source map returned')
    }
    if (!sourceMapChecks.hasVersion3) {
      errors.push('Source map version is not 3')
    }
    if (!sourceMapChecks.hasSources) {
      errors.push('Source map has no sources')
    }
    if (!sourceMapChecks.hasSourcesContent) {
      errors.push('Source map has no sourcesContent')
    }
    if (!sourceMapChecks.hasMappings) {
      errors.push('Source map has no mappings')
    }

    if (errors.length > 0) {
      console.log('\n❌ E2E test FAILED:')
      errors.forEach(e => console.log(`   - ${e}`))
      process.exit(1)
    } else {
      console.log('\n✅ E2E test PASSED! All validator types found.')
    }

    console.log('\n4. Releasing project...')
    await compiler.release(project)
    console.log('   ✓ Project released\n')
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  } finally {
    await compiler.close()
    console.log('5. Compiler closed')
  }
}

void main()
