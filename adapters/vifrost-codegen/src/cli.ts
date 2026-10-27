#!/usr/bin/env node
import { Command } from 'commander'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { generateSchema } from './generate.js'
import { loadSchema } from './schema.js'

const program = new Command()

program
  .name('vifrost-codegen')
  .description('Generates typed @vifrost/client Model classes from a Laravel Vifrost schema JSON export.')
  .requiredOption('-i, --input <pathOrUrl>', 'path to the schema JSON file, or the vifrost.schema_route_path URL')
  .requiredOption('-o, --output <dir>', 'directory to write the generated .ts files to')
  .option('-t, --type-map <path>', 'path to a JSON file with { "dbTypeName": "tsType" } overrides')
  .option('-c, --client-import <specifier>', 'import specifier for the runtime client', '@vifrost/client')

program.parse()

const options = program.opts<{
  input: string
  output: string
  typeMap?: string
  clientImport: string
}>()

const schema = await loadSchema(options.input)

const overrides = options.typeMap ? (JSON.parse(await readFile(options.typeMap, 'utf-8')) as Record<string, string>) : undefined

const files = generateSchema(schema, {
  overrides,
  clientImport: options.clientImport,
  onWarning: (message) => console.warn(message),
})

await mkdir(options.output, { recursive: true })

for (const file of files) {
  await writeFile(path.join(options.output, file.fileName), file.content, 'utf-8')
}

console.log(`Generated ${files.length} file(s) in ${options.output}`)
