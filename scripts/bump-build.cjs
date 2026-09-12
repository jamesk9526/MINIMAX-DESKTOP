const fs = require('node:fs')
const path = require('node:path')

const packagePath = path.resolve(__dirname, '..', 'package.json')
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(packageJson.version)

if (!match) {
  console.error(`Cannot roll build number: package version "${packageJson.version}" is not numeric semver.`)
  process.exit(1)
}

const [, major, minor, patch] = match
const nextVersion = `${major}.${minor}.${Number(patch) + 1}`
packageJson.version = nextVersion

fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)
console.log(`Building Oyama AI Video Studio ${nextVersion}`)
