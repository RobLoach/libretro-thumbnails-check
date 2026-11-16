'use strict'

// Dependencies
var fs = require('fs')
var path = require('path')
var os = require('os')
var childProcess = require('child_process')
var execFileSync = childProcess.execFileSync
var execFile = require('util').promisify(childProcess.execFile)
var globby = require('globby')
var datfile = require('robloach-datfile')
var table = require('text-table')
var batchreplace = require('batchreplace')
var sort = require('sort-object-keys')
var exists = require('fs-exists-sync')

// Thumbnail types, mapping each game report key to its libretro-thumbnails directory.
const THUMBNAIL_TYPES = {
	boxart: 'Named_Boxarts',
	snap: 'Named_Snaps',
	title: 'Named_Titles',
	logo: 'Named_Logos'
}

// Construct the thumbnail cleaner.
var cleanGameName = batchreplace.mapReplacer({
	'&': '_',
	'*': '_',
	'/': '_',
	':': '_',
	'\`': '_',
	'<': '_',
	'>': '_',
	'?': '_',
	'\\': '_',
	'|': '_',
	'"': '_'
})

/**
 * Go through all games of a system, and check their thumbnails.
 */
function processSystem(system) {
	return new Promise(function (resolve, reject) {
		var patterns = [
			// Only report on No-Intro and custom DATs.
			//'libretro-database/metadat/goodtools/' + system + '.dat',
			//'libretro-database/metadat/libretro-dats/' + system + '.dat',
			'libretro-database/metadat/mame/' + system + '.dat',
			'libretro-database/metadat/mame-split/' + system + '.dat',
			'libretro-database/metadat/mame-member/' + system + '.dat',
			'libretro-database/metadat/redump/' + system + '.dat',
			'libretro-database/metadat/tosec/' + system + '.dat',
			'libretro-database/metadat/no-intro/' + system + '.dat',
			'libretro-database/dat/' + system + '.dat'
		]
		globby(patterns, { cwd: __dirname, absolute: true }).then(function (paths) {
			var promises = []
			for (var i in paths) {
				var file = paths[i]
				// TODO: Fix the MAME.dat parsing.
				if (file.indexOf('MAME.dat') < 0) {
					promises.push(datfile.parseFile(file, {
						ignoreHeader: true
					}))
				}
			}
			resolve(Promise.all(promises))
		}).catch(function (err) {
			reject(new Error(err))
		})
	})
}

/**
 * Returns an object with a true value for each THUMBNAIL_TYPES key (boxart, snap,
 * title, logo) the game has a thumbnail for.
 */
function getGameThumbnails(thumbs, system, name) {
	var result = {}

	for (let key in THUMBNAIL_TYPES) {
		if (thumbs.has(`${THUMBNAIL_TYPES[key]}/${name}.png`)) {
			result[key] = true
		}
	}

	return result
}

/**
 * Writes a system report containing the thumbnails.
 *
 * Pass hasRepo as false when the system has no thumbnail repository, and invalid as
 * the result of findInvalidThumbnails(). The report files are written to outDir.
 */
function writeReport(system, games, thumbs, hasRepo = true, invalid = {}, outDir = path.join(__dirname, 'out')) {
	if (!exists(outDir)) {
		fs.mkdirSync(outDir)
	}
	games = sort(games)
	let output = system + ' Missing\n\n'
	let count = {
		boxart: 0,
		snap: 0,
		title: 0,
		logo: 0,
		invalid: 0,
		total: Object.keys(games).length
	}
	if (!hasRepo) {
		count.noRepo = true
		output += 'No thumbnails repository at https://github.com/' + THUMBNAILS_ORG + '/' + thumbnailRepo(system) + '\n\n'
	}
	if (Object.keys(games).length <= 0) {
		output += 'Error parsing dat files.'
	}
	else {
		let entries = []
		entries.push(['Name', 'Boxart', 'Snap', 'Title', 'Logo'])
		for (let gameName in games) {
			if (games[gameName]) {
				let game = games[gameName]
				// Use the thumbnail file name.
				gameName = cleanGameName(gameName)

				let boxart = game.boxart ? '-' : '✗'
				let snap = game.snap ? '-' : '✗'
				let title = game.title ? '-' : '✗'
				let logo = game.logo ? '-' : '✗'

				if (game.boxart) {
					count.boxart++
				}
				if (game.snap) {
					count.snap++
				}
				if (game.title) {
					count.title++
				}
				if (game.logo) {
					count.logo++
				}
				//if (boxart == '✗' || snap == '✗' || title == '✗') {
					entries.push([gameName, boxart, snap, title, logo])
				//}
			}
		}

		// Every thumbnail type counts towards the total.
		let summary = []
		let total = 0
		for (let key in THUMBNAIL_TYPES) {
			summary.push([THUMBNAIL_TYPES[key].replace('Named_', ''), count[key] + '/' + count.total, (count[key] / count.total * 100).toFixed(2) + '%'])
			total += count[key]
		}
		let possible = count.total * Object.keys(THUMBNAIL_TYPES).length
		summary.push(['Total', total + '/' + possible, (total / possible * 100).toFixed(2) + '%'])
		output += table(summary, {
			align: ['l', 'r', 'r']
		})

		output += '\n\n' + table(entries, {
			align: ['l', 'c', 'c', 'c', 'c']
		})

		// Orphans are thumbnails that match no game.
		let matched = new Set()
		for (let gameName in games) {
			let name = cleanGameName(gameName)
			for (let type of Object.values(THUMBNAIL_TYPES)) {
				matched.add(`${type}/${name}.png`)
			}
		}
		let orphans = [...thumbs].filter((thumb) => !matched.has(thumb))
		let orphansFile = path.join(outDir, system + ' Orphans.txt')
		if (orphans.length > 0) {
			fs.writeFileSync(orphansFile, system + ' Orphans\n\n' + orphans.join('\n'))
		}
		else {
			fs.rmSync(orphansFile, { force: true })
		}
	}
	fs.writeFileSync(path.join(outDir, system + '.txt'), output)

	// Invalid thumbnails, grouped by reason.
	let invalidOutput = ''
	let invalidPaths = new Set()
	for (let reason in INVALID_REASONS) {
		let items = invalid[reason] || []
		if (items.length > 0) {
			invalidOutput += `\n\n${INVALID_REASONS[reason]}\n\n` + items.map((item) => item.detail ? `${item.path} ${item.detail}` : item.path).join('\n')
			items.forEach((item) => invalidPaths.add(item.path))
		}
	}
	count.invalid = invalidPaths.size
	let invalidFile = path.join(outDir, system + ' Invalid.txt')
	if (invalidPaths.size > 0) {
		fs.writeFileSync(invalidFile, system + ' Invalid' + invalidOutput)
	}
	else {
		fs.rmSync(invalidFile, { force: true })
	}
	return count
}

// GitHub organization holding one thumbnail repository per system.
const THUMBNAILS_ORG = 'libretro-thumbnails'

// Systems whose repository name isn't just the system name with spaces as underscores.
const REPO_OVERRIDES = {
	"Jump 'n Bump": 'Jump_n_Bump',
	'Philips - Videopac+': 'Philips_-_Videopac'
}

// Tree entry modes for regular files, executables and symlinks.
const FILE_MODES = new Set(['100644', '100755', '120000'])

/**
 * Returns the libretro-thumbnails repository name for a system.
 */
function thumbnailRepo(system) {
	return REPO_OVERRIDES[system] || system.split(' ').join('_')
}

/**
 * Finds a GitHub token from GITHUB_TOKEN, or from the GitHub CLI.
 */
function githubToken() {
	if (process.env.GITHUB_TOKEN) {
		return process.env.GITHUB_TOKEN
	}
	try {
		let token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
		if (token) {
			return token
		}
	}
	catch (error) {
		// Fall through to the error below.
	}
	throw new Error('No GitHub token found. Set GITHUB_TOKEN, or log in with `gh auth login`.')
}

/**
 * Creates the GitHub client once, retrying transient failures and waiting out rate limits.
 */
let octokitPromise = null
function getOctokit() {
	if (!octokitPromise) {
		octokitPromise = (async function () {
			let auth = githubToken()
			// Octokit is ESM-only, so load it with a dynamic import.
			const { Octokit } = await import('@octokit/rest')
			const { retry } = await import('@octokit/plugin-retry')
			const { throttling } = await import('@octokit/plugin-throttling')
			const ThrottledOctokit = Octokit.plugin(retry, throttling)
			return new ThrottledOctokit({
				auth: auth,
				userAgent: 'libretro-thumbnails-check',
				// Failed requests are reported by the caller, as a 404 is expected for systems without a repository.
				log: {
					debug: function () {},
					info: function () {},
					warn: console.warn,
					error: function () {}
				},
				throttle: {
					onRateLimit: function (retryAfter, options, octokit, retryCount) {
						octokit.log.warn(`Rate limit hit for ${options.method} ${options.url}, retrying in ${retryAfter}s`)
						return retryCount < 2
					},
					onSecondaryRateLimit: function (retryAfter, options, octokit, retryCount) {
						octokit.log.warn(`Secondary rate limit hit for ${options.method} ${options.url}, retrying in ${retryAfter}s`)
						return retryCount < 2
					}
				}
			})
		})()
		// Allow a later call to try again after a failure.
		octokitPromise.catch(function () {
			octokitPromise = null
		})
	}
	return octokitPromise
}

/**
 * Checks that the GitHub token works, without using up the rate limit.
 */
async function checkGitHubAuth() {
	let octokit = await getOctokit()
	try {
		await octokit.rest.rateLimit.get()
	}
	catch (error) {
		throw new Error(`GitHub authentication failed: ${error.message}`)
	}
}

/**
 * Fetches a git tree from a thumbnail repository.
 */
async function fetchTree(octokit, repo, treeSha, recursive) {
	let params = {
		owner: THUMBNAILS_ORG,
		repo: repo,
		tree_sha: treeSha
	}
	if (recursive) {
		params.recursive = '1'
	}
	let response = await octokit.rest.git.getTree(params)
	return response.data
}

/**
 * Lists every file in a thumbnail repository with a shallow, blobless git clone.
 *
 * Used for directories too large for the GitHub API. Entries have no size, as that
 * would need the blobs.
 */
async function gitTreeEntries(repo) {
	let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'libretro-thumbnails-'))
	try {
		await execFile('git', ['clone', '--quiet', '--bare', '--depth', '1', '--filter=blob:none', `https://github.com/${THUMBNAILS_ORG}/${repo}.git`, dir])
		let result = await execFile('git', ['-C', dir, 'ls-tree', '-r', '-z', 'HEAD'], { maxBuffer: 1024 * 1024 * 1024 })
		// Each entry is "<mode> <type> <sha>\t<path>".
		return result.stdout.split('\0').filter(Boolean).map(function (line) {
			let tab = line.indexOf('\t')
			let [mode, type, sha] = line.slice(0, tab).split(' ')
			return { path: line.slice(tab + 1), mode: mode, type: type, sha: sha }
		})
	}
	finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
}

/**
 * Builds the list of thumbnails for a system from its libretro-thumbnails repository.
 *
 * Returns an array of tree entries ({ path, mode, type, size, sha }) for the files and
 * symlinks in the repository, or null when the system has no thumbnail repository. For
 * repositories too large to list at once, only the root files and the directories that look
 * like thumbnail directories are included.
 */
async function fetchThumbnailIndex(system) {
	let octokit = await getOctokit()
	let repo = thumbnailRepo(system)
	let tree
	try {
		tree = await fetchTree(octokit, repo, 'HEAD', true)
	}
	catch (error) {
		if (error.status == 404) {
			return null
		}
		// The repository exists, but is empty.
		if (error.status == 409) {
			return []
		}
		throw new Error(`${error.message} (${THUMBNAILS_ORG}/${repo})`)
	}

	let entries = tree.tree
	if (tree.truncated) {
		// Too large for one listing, so fetch each Named_* directory on its own.
		entries = []
		let root = await fetchTree(octokit, repo, 'HEAD', false)
		for (let dir of root.tree) {
			if (dir.type != 'tree') {
				entries.push(dir)
				continue
			}
			if (!isThumbnailFolder(dir.path)) {
				continue
			}
			let subtree = await fetchTree(octokit, repo, dir.sha, true)
			if (subtree.truncated) {
				// The API can't list more than 100,000 entries, so read the tree with git instead.
				entries = await gitTreeEntries(repo)
				break
			}
			for (let entry of subtree.tree) {
				entries.push(Object.assign({}, entry, { path: dir.path + '/' + entry.path }))
			}
		}
	}

	return entries.filter((entry) => FILE_MODES.has(entry.mode))
}

/**
 * Returns the THUMBNAIL_TYPES paths (Named_X/<name>.png) of a thumbnail index as a Set.
 */
function thumbnails(index) {
	let pattern = new RegExp(`^(${Object.values(THUMBNAIL_TYPES).join('|')})/[^/]+\\.png$`)
	return new Set((index || []).map((entry) => entry.path).filter((file) => pattern.test(file)))
}

/**
 * Returns whether a top-level directory looks like it's meant to hold thumbnails.
 */
function isThumbnailFolder(dir) {
	return /^named_|boxart|snap|title|logo/i.test(dir)
}

// Files smaller than this can't be a real thumbnail, as the smallest valid PNG is about 67 bytes.
const MIN_THUMBNAIL_SIZE = 100

// Characters RetroArch replaces with "_" in thumbnail names, so files containing them never match.
const BAD_FILENAME_CHARS = /[&*/:`<>?\\|"]/

// Kinds of invalid thumbnails, in report order.
const INVALID_REASONS = {
	notPng: 'Not a PNG',
	badChars: 'Bad filename characters',
	tooSmall: 'Empty or tiny files',
	unknownFolder: 'Unknown folders',
	brokenSymlink: 'Broken symlinks'
}

/**
 * Finds invalid thumbnails in a thumbnail index using only the tree metadata.
 *
 * symlinkTargets maps a symlink blob sha to its target. Symlinks with an unknown target
 * aren't checked. Returns an object with an array of { path, detail } for each
 * INVALID_REASONS key.
 */
function findInvalidThumbnails(index, symlinkTargets = {}) {
	let invalid = {}
	for (let reason in INVALID_REASONS) {
		invalid[reason] = []
	}
	let types = new Set(Object.values(THUMBNAIL_TYPES))
	let paths = new Set((index || []).map((entry) => entry.path))
	for (let entry of index || []) {
		let dir = path.posix.dirname(entry.path)
		let name = path.posix.basename(entry.path)
		// Dotfiles like .gitkeep and .gitignore aren't thumbnails.
		if (entry.path.split('/').some((part) => part.startsWith('.'))) {
			continue
		}
		if (!types.has(dir)) {
			// Root files like README.md aren't thumbnails.
			if (dir != '.' && isThumbnailFolder(entry.path.split('/')[0])) {
				invalid.unknownFolder.push({ path: entry.path })
			}
			continue
		}
		if (!name.endsWith('.png')) {
			invalid.notPng.push({ path: entry.path })
		}
		if (BAD_FILENAME_CHARS.test(name)) {
			invalid.badChars.push({ path: entry.path })
		}
		if (entry.mode == '120000') {
			let target = symlinkTargets[entry.sha]
			if (target === undefined) {
				continue
			}
			let resolved = path.posix.normalize(path.posix.join(dir, target))
			if (path.posix.isAbsolute(target) || resolved == '..' || resolved.startsWith('../')) {
				invalid.brokenSymlink.push({ path: entry.path, detail: `-> ${target} (outside the repository)` })
			}
			else if (!paths.has(resolved)) {
				invalid.brokenSymlink.push({ path: entry.path, detail: `-> ${target}` })
			}
		}
		// A symlink's size is the length of its target, so only check regular files.
		else if (entry.size !== undefined && entry.size < MIN_THUMBNAIL_SIZE) {
			invalid.tooSmall.push({ path: entry.path, detail: `(${entry.size} bytes)` })
		}
	}
	return invalid
}

// Symlink targets by blob sha, cached across runs as blobs never change.
const SYMLINK_CACHE = path.join(__dirname, '.cache', 'symlinks.json')
let symlinkCache = null

/**
 * Fetches the targets of a system's symlinks, keyed by blob sha.
 *
 * Uncached symlink blobs are read with batched GraphQL queries, 100 blobs per query.
 */
async function fetchSymlinkTargets(system, index) {
	if (!symlinkCache) {
		try {
			symlinkCache = JSON.parse(fs.readFileSync(SYMLINK_CACHE, 'utf8'))
		}
		catch (error) {
			symlinkCache = {}
		}
	}
	let shas = (index || []).filter((entry) => entry.mode == '120000').map((entry) => entry.sha)
	let missing = [...new Set(shas)].filter((sha) => !(sha in symlinkCache))
	if (missing.length > 0) {
		let octokit = await getOctokit()
		try {
			for (let i = 0; i < missing.length; i += 100) {
				let batch = missing.slice(i, i + 100)
				let fields = batch.map((sha, n) => `s${n}: object(oid: "${sha}") { ... on Blob { text } }`).join('\n')
				let result = await octokit.graphql(`query ($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`, {
					owner: THUMBNAILS_ORG,
					name: thumbnailRepo(system)
				})
				batch.forEach(function (sha, n) {
					let blob = result.repository[`s${n}`]
					if (blob && typeof blob.text == 'string') {
						symlinkCache[sha] = blob.text
					}
				})
			}
		}
		finally {
			// Keep what was fetched, even when a later batch fails.
			fs.mkdirSync(path.dirname(SYMLINK_CACHE), { recursive: true })
			fs.writeFileSync(SYMLINK_CACHE, JSON.stringify(symlinkCache))
		}
	}
	let targets = {}
	for (let sha of shas) {
		if (sha in symlinkCache) {
			targets[sha] = symlinkCache[sha]
		}
	}
	return targets
}

/**
 * Returns the report file names, out of fileNames, that don't belong to any of
 * the given systems. A file belongs to a system when its name without `.txt` is
 * the system, or the system followed by " Orphans" or " Invalid". Files that
 * aren't `.txt` are never returned.
 */
function staleReports(fileNames, systems) {
	let known = new Set(systems)
	return fileNames.filter((fileName) => {
		if (!fileName.endsWith('.txt')) {
			return false
		}
		let name = fileName.slice(0, -'.txt'.length)
		if (known.has(name)) {
			return false
		}
		for (let suffix of [' Orphans', ' Invalid']) {
			if (name.endsWith(suffix) && known.has(name.slice(0, -suffix.length))) {
				return false
			}
		}
		return true
	})
}

// DAT files that set game names, in the order the .rdb build reads them. Later files win,
// so dat/ takes precedence over metadat/. See libretro-super's libretro-build-database.sh.
const NAME_SOURCES = [
	'metadat/{system}.dat',
	'metadat/goodtools/{system}.dat',
	'metadat/headered/{system}.dat',
	'metadat/hacks/{system}.dat',
	'metadat/homebrew/{system}.dat',
	'metadat/mame-nonmerged/{system}.dat',
	'metadat/mame-split/{system}.dat',
	'metadat/mame-member/{system}.dat',
	'metadat/mame/{system}.dat',
	'metadat/fbneo-merged/{system}.dat',
	'metadat/fbneo-split/{system}.dat',
	'metadat/fbneo-member/{system}.dat',
	'metadat/tosec/{system}.dat',
	'metadat/libretro-dats/{system}.dat',
	'metadat/redump/{system}.dat',
	'metadat/no-intro/{system}.dat',
	'metadat/lost-level-archive/{system}.dat',
	'dat/{system}.dat'
]

// Systems RetroArch matches by serial rather than CRC.
const SERIAL_SYSTEMS = new Set([
	'Microsoft - Xbox 360',
	'Nintendo - GameCube',
	'Nintendo - Nintendo Switch',
	'Nintendo - Wii',
	'Nintendo - Wii U',
	'Sega - Dreamcast',
	'Sega - Mega-CD - Sega CD',
	'Sega - Naomi',
	'Sega - Naomi 2',
	'Sega - Saturn',
	'Sony - PlayStation',
	'Sony - PlayStation 2',
	'Sony - PlayStation 3',
	'Sony - PlayStation Portable',
	'Sony - PlayStation Vita'
])

/**
 * Returns whether a system's games are matched by serial or by crc.
 */
function matchKey(system) {
	return SERIAL_SYSTEMS.has(system) ? 'serial' : 'crc'
}

/**
 * Maps each CRC (uppercased) or serial to the game name RetroArch shows.
 *
 * dats is an array of parsed DAT files in NAME_SOURCES order, so later files win. Games
 * without a name, like the metadata-only DATs, are skipped.
 */
function gameNames(dats, key = 'crc') {
	let names = new Map()
	for (let games of dats) {
		for (let game of games || []) {
			if (!game.name) {
				continue
			}
			let keys = []
			if (key == 'serial' && game.serial) {
				keys.push(game.serial)
			}
			for (let rom of game.entries || []) {
				if (rom[key]) {
					keys.push(rom[key])
				}
			}
			for (let value of keys) {
				names.set(key == 'crc' ? value.toUpperCase() : value, game.name)
			}
		}
	}
	return names
}

/**
 * Returns { key, from, to } for every key whose game name changed between two gameNames() maps.
 */
function renamedGames(oldNames, newNames) {
	let renames = []
	for (let [key, from] of oldNames) {
		let to = newNames.get(key)
		if (to !== undefined && to != from) {
			renames.push({ key: key, from: from, to: to })
		}
	}
	return renames
}

/**
 * Returns the { path, target } symlinks that give renamed games their thumbnails back.
 *
 * For each rename and thumbnail type, links Named_X/<new>.png to Named_X/<old>.png when the
 * old image exists and the new one doesn't. When the old image is a symlink, the link points
 * at its final target instead. Symlinks with an unknown target are linked to as they are, and
 * broken ones are skipped. The target is relative to the link's folder.
 */
function thumbnailLinks(renames, index, symlinkTargets = {}) {
	let entries = new Map((index || []).map((entry) => [entry.path, entry]))
	let links = []
	let added = new Set()

	// Follows symlinks to the final file, or returns null when broken.
	function resolve(file) {
		let seen = new Set()
		let entry = entries.get(file)
		while (entry && entry.mode == '120000') {
			let target = symlinkTargets[entry.sha]
			if (target === undefined) {
				return file
			}
			if (seen.has(file) || path.posix.isAbsolute(target)) {
				return null
			}
			seen.add(file)
			file = path.posix.normalize(path.posix.join(path.posix.dirname(file), target))
			entry = entries.get(file)
		}
		return entry ? file : null
	}

	for (let rename of renames) {
		let from = cleanGameName(rename.from)
		let to = cleanGameName(rename.to)
		if (from == to) {
			continue
		}
		for (let dir of Object.values(THUMBNAIL_TYPES)) {
			let link = `${dir}/${to}.png`
			if (entries.has(link) || added.has(link)) {
				continue
			}
			let target = resolve(`${dir}/${from}.png`)
			if (!target || target == link) {
				continue
			}
			added.add(link)
			links.push({ path: link, target: path.posix.relative(dir, target) })
		}
	}
	return links
}

/**
 * Quotes a string for a POSIX shell.
 */
function shellQuote(value) {
	return "'" + value.split("'").join("'\\''") + "'"
}

/**
 * Renders a shell script that adds the thumbnailLinks() symlinks to a thumbnail repository.
 *
 * The links are added to the git index without needing the images, so it runs in a sparse,
 * blobless clone.
 */
function linkScript(system, links) {
	let repo = thumbnailRepo(system)
	let lines = [
		'#!/bin/sh',
		`# Links ${system} thumbnails of games renamed in libretro-database to their new name.`,
		'# Run inside a clone of the thumbnail repository, then commit:',
		`#   git clone --filter=blob:none --sparse https://github.com/${THUMBNAILS_ORG}/${repo}.git`,
		`#   cd ${repo} && sh "/path/to/${system}.sh" && git commit -m "Link renamed games"`,
		'set -e',
		'',
		'# link <path> <target>',
		'link() {',
		'\tblob=$(printf \'%s\' "$2" | git hash-object -w --stdin)',
		'\tgit update-index --add --cacheinfo "120000,$blob,$1"',
		'\tgit update-index --skip-worktree "$1"',
		'}',
		''
	]
	for (let link of links) {
		lines.push(`link ${shellQuote(link.path)} ${shellQuote(link.target)}`)
	}
	return lines.join('\n') + '\n'
}

// Files in each libretro-database revision, cached by revision.
const revisionFiles = {}

/**
 * Parses the DAT files that name a system's games, in NAME_SOURCES order.
 *
 * Reads the libretro-database checkout, or the given git revision of it.
 */
async function readNameDats(system, revision = null) {
	let database = path.join(__dirname, 'libretro-database')
	if (revision && !revisionFiles[revision]) {
		let result = await execFile('git', ['-C', database, 'ls-tree', '-r', '-z', '--name-only', revision, '--', 'dat', 'metadat'], { maxBuffer: 256 * 1024 * 1024 })
		revisionFiles[revision] = new Set(result.stdout.split('\0').filter(Boolean))
	}
	let dats = []
	for (let source of NAME_SOURCES) {
		let file = source.replace('{system}', system)
		// TODO: Fix the MAME.dat parsing.
		if (file.indexOf('MAME.dat') >= 0) {
			continue
		}
		let contents
		if (revision) {
			if (!revisionFiles[revision].has(file)) {
				continue
			}
			contents = (await execFile('git', ['-C', database, 'show', `${revision}:${file}`], { maxBuffer: 1024 * 1024 * 1024 })).stdout
		}
		else if (exists(path.join(database, file))) {
			contents = fs.readFileSync(path.join(database, file), 'utf8')
		}
		else {
			continue
		}
		dats.push(await datfile.parse(contents, { ignoreHeader: true }))
	}
	return dats
}

module.exports = {
	processSystem: processSystem,
	writeReport: writeReport,
	thumbnails: thumbnails,
	fetchThumbnailIndex: fetchThumbnailIndex,
	findInvalidThumbnails: findInvalidThumbnails,
	fetchSymlinkTargets: fetchSymlinkTargets,
	checkGitHubAuth: checkGitHubAuth,
	thumbnailRepo: thumbnailRepo,
	getGameThumbnails: getGameThumbnails,
	cleanGameName: cleanGameName,
	staleReports: staleReports,
	matchKey: matchKey,
	gameNames: gameNames,
	renamedGames: renamedGames,
	thumbnailLinks: thumbnailLinks,
	linkScript: linkScript,
	readNameDats: readNameDats,
	THUMBNAIL_TYPES: THUMBNAIL_TYPES
}
