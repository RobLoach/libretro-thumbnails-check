#!/usr/bin/env node
'use strict'

var fs = require('fs')
var path = require('path')
var glob = require('glob')
var execFileSync = require('child_process').execFileSync
var {
	matchKey,
	gameNames,
	renamedGames,
	thumbnailLinks,
	linkScript,
	readNameDats,
	fetchThumbnailIndex,
	fetchSymlinkTargets,
	checkGitHubAuth
} = require('..')

// Resolve all paths relative to the project root, not the working directory.
var root = path.join(__dirname, '..')

var usage = 'Usage: libretro-thumbnails-links --from <libretro-database revision> [--system "<name>"]... [--out <dir>]'
var from = null
var onlySystems = []
var outDir = path.join(root, 'out', 'links')
var args = process.argv.slice(2)
for (var i = 0; i < args.length; i++) {
	// Accept both "--name value" and "--name=value".
	let [arg, value] = args[i].split(/=(.*)/s)
	if (value === undefined) {
		value = args[++i]
	}
	if (!['--from', '--system', '--out'].includes(arg) || value === undefined) {
		console.error(`Unknown argument: ${arg}\n${usage}`)
		process.exit(1)
	}
	if (arg == '--from') {
		from = value
	}
	else if (arg == '--system') {
		onlySystems.push(value)
	}
	else {
		outDir = path.resolve(value)
	}
}
if (!from) {
	console.error(usage)
	process.exit(1)
}
try {
	execFileSync('git', ['-C', path.join(root, 'libretro-database'), 'rev-parse', '--verify', '--quiet', from + '^{commit}'], { stdio: 'ignore' })
}
catch (error) {
	console.error(`Unknown libretro-database revision: ${from}. Fetch it with \`git -C libretro-database fetch --unshallow\` first.`)
	process.exit(1)
}

(async function () {
	let systems = glob.sync('libretro-database/rdb/*.rdb', { cwd: root }).map((file) => path.parse(file).name)
	if (onlySystems.length > 0) {
		let unknown = onlySystems.filter((system) => !systems.includes(system))
		if (unknown.length > 0) {
			console.error(`Unknown system(s): ${unknown.join(', ')}`)
			process.exit(1)
		}
		systems = onlySystems
	}

	let authChecked = false
	for (let system of systems) {
		let script = path.join(outDir, system + '.sh')
		let key = matchKey(system)
		let renames = renamedGames(gameNames(await readNameDats(system, from), key), gameNames(await readNameDats(system), key))
		let links = []
		if (renames.length > 0) {
			// Only reach GitHub when there's something to link.
			if (!authChecked) {
				await checkGitHubAuth()
				authChecked = true
			}
			let index = await fetchThumbnailIndex(system)
			let targets = {}
			try {
				targets = await fetchSymlinkTargets(system, index)
			}
			catch (error) {
				// Without the targets, symlinks are linked to as they are.
				console.warn(`${system}: Symlink fetch failed: ${error.message}`)
			}
			links = thumbnailLinks(renames, index, targets)
		}
		if (links.length > 0) {
			fs.mkdirSync(outDir, { recursive: true })
			fs.writeFileSync(script, linkScript(system, links))
			console.log(`${system}: ${renames.length} renamed, ${links.length} link(s) in ${path.relative(process.cwd(), script)}`)
		}
		else {
			fs.rmSync(script, { force: true })
			console.log(`${system}: ${renames.length} renamed, nothing to link`)
		}
	}
})().catch(function (err) {
	console.error(err.message || err)
	process.exitCode = 1
})
