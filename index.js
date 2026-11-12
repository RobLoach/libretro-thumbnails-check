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
 * Returns an array of objects, with the following boolean values:
 * - boxart
 * - snap
 * - title
 */
function getGameThumbnails(thumbs, system, name) {
	var result = {}

	if (thumbs.has(`Named_Boxarts/${name}.png`)) {
		result.boxart = true
	}
	if (thumbs.has(`Named_Snaps/${name}.png`)) {
		result.snap = true
	}
	if (thumbs.has(`Named_Titles/${name}.png`)) {
		result.title = true
	}

	return result
}

/**
 * Writes a system report containing the thumbnails.
 *
 * Pass hasRepo as false when the system has no thumbnail repository.
 */
function writeReport(system, games, thumbs, hasRepo = true) {
	let outDir = path.join(__dirname, 'out')
	if (!exists(outDir)) {
		fs.mkdirSync(outDir)
	}
	games = sort(games)
	let output = system + ' Missing\n\n'
	let count = {
		boxart: 0,
		snap: 0,
		title: 0,
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
		entries.push(['Name', 'Boxart', 'Snap', 'Title'])
		for (let gameName in games) {
			if (games[gameName]) {
				let game = games[gameName]
				// Use the thumbnail file name.
				gameName = cleanGameName(gameName)

				let boxart = game.boxart ? '-' : '✗'
				let snap = game.snap ? '-' : '✗'
				let title = game.title ? '-' : '✗'

				if (game.boxart) {
					count.boxart++
				}
				if (game.snap) {
					count.snap++
				}
				if (game.title) {
					count.title++
				}
				//if (boxart == '✗' || snap == '✗' || title == '✗') {
					entries.push([gameName, boxart, snap, title])
				//}
			}
		}

		let total = count.snap + count.boxart + count.title
		output += table([
			['Boxarts', count.boxart + '/' + count.total, (count.boxart / count.total * 100).toFixed(2) + '%'],
			['Snaps', count.snap + '/' + count.total, (count.snap / count.total * 100).toFixed(2) + '%'],
			['Titles', count.title + '/' + count.total, (count.title / count.total * 100).toFixed(2) + '%'],
			['Total', total + '/' + count.total * 3, ((total / (count.total * 3)) * 100).toFixed(2) + '%']
		], {
			align: ['l', 'r', 'r']
		})

		output += '\n\n' + table(entries, {
			align: ['l', 'c', 'c', 'c']
		})

		// Orphans are thumbnails that match no game.
		let matched = new Set()
		for (let gameName in games) {
			let name = cleanGameName(gameName)
			for (let type of ['Named_Boxarts', 'Named_Snaps', 'Named_Titles']) {
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
 * symlinks in the Named_* directories, or null when the system has no thumbnail repository.
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
			if (dir.type != 'tree' || !dir.path.startsWith('Named_')) {
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

	return entries.filter((entry) => FILE_MODES.has(entry.mode) && entry.path.startsWith('Named_'))
}

/**
 * Returns the boxart, snap and title paths (Named_X/<name>.png) of a thumbnail index as a Set.
 */
function thumbnails(index) {
	let pattern = /^Named_(Boxarts|Snaps|Titles)\/[^\/]+\.png$/
	return new Set((index || []).map((entry) => entry.path).filter((file) => pattern.test(file)))
}

module.exports = {
	processSystem: processSystem,
	writeReport: writeReport,
	thumbnails: thumbnails,
	fetchThumbnailIndex: fetchThumbnailIndex,
	checkGitHubAuth: checkGitHubAuth,
	thumbnailRepo: thumbnailRepo,
	getGameThumbnails: getGameThumbnails,
	cleanGameName: cleanGameName
}
