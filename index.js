// Dependencies
var path = require('path')
var fs = require('fs')
var glob = require('glob')
var globby = require('globby')
var datfile = require('robloach-datfile')
var minimatch = require('minimatch')
var table = require('text-table')
var download = require('download-file-sync')
var fileExists = require('file-exists')
var sanitizeFilename = require('sanitize-filename')
var sleep = require('sleep')
var batchreplace = require('batchreplace')
var sort = require('sort-object')
var Listr = require('listr')
var exists = require('fs-exists-sync')

// Set the GitHub access token below.
var access = ''
//var access = '?access_token='

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
	'|': '_'
})

/**
 * Go through all games of a system, and check their thumbnails.
 */
function processSystem(system) {
	return new Promise(function (resolve, reject) {
		if (fileExists('out/' + system + '.txt')) {
			return resolve([])
		}
		var patterns = [
			// Only report on No-Intro and custom DATs.
			//'libretro-database/metadat/goodtools/' + system + '.dat',
			//'libretro-database/metadat/libretro-dats/' + system + '.dat',
			'libretro-database/metadat/no-intro/' + system + '.dat',
			'libretro-database/dat/' + system + '.dat'
		]
		globby(patterns).then(function (paths) {
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
	var out = minimatch.match(thumbs, system + '/*/' + name + '.png', {matchBase: true})
	var result = {}
	for (var i in out) {
		var str = out[i]
		var index = -1
		if (str.indexOf('Named_Boxarts') > 0) {
			result.boxart = true
			index = thumbs.indexOf(str)
		}
		else if (str.indexOf('Named_Snaps') > 0) {
			result.snap = true
			index = thumbs.indexOf(str)
		}
		else if (str.indexOf('Named_Titles') > 0) {
			result.title = true
			index = thumbs.indexOf(str)
		}
		if (index > -1) {
			thumbs.splice(index, 1)
		}
	}
	return result
}

/**
 * Writes a system report containing the thumbnails.
 */
function writeReport(system, games, thumbs) {
	if (!exists('out')) {
		fs.mkdirSync('out')
	}
	games = sort(games)
	var output = system + '\n\n'
	var count = {
		boxart: 0,
		snap: 0,
		title: 0,
		total: Object.keys(games).length
	}
	if (Object.keys(games).length <= 0) {
		output += 'Error parsing dat files.'
	}
	else {
		var entries = []
		entries.push(['Name', 'Boxart', 'Snap', 'Title'])
		for (var gameName in games) {
			if (games[gameName]) {
				var game = games[gameName]
				// Use the thumbnail file name.
				gameName = cleanGameName(gameName)

				var boxart = game.boxart ? '✓' : '✗'
				var snap = game.snap ? '✓' : '✗'
				var title = game.title ? '✓' : '✗'

				if (game.boxart) {
					count.boxart++
				}
				if (game.snap) {
					count.snap++
				}
				if (game.title) {
					count.title++
				}
				entries.push([gameName, boxart, snap, title])
			}
		}

		var total = count.snap + count.boxart + count.title
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

		var orphans = ''
		for (var o in thumbs) {
			orphans += '\n' + thumbs[o].replace(system + '/', '')
		}
		if (orphans.length >= 5) {
			orphans = system + ' Orphans\n' + orphans
			fs.writeFileSync('out/' + system + ' Orphans.txt', orphans)
		}
	}
	fs.writeFileSync('out/' + system + '.txt', output)
	return count
}

/**
 * Downloads the index of all thumbnails.
 */
function thumbnails(system) {
	var thumbs = []
	var all = getData('https://api.github.com/repos/libretro/libretro-thumbnails/git/trees/master')
	for (var i in all.tree) {
		var entry = all.tree[i]
		if (entry.path == system) {
			var data = getData(entry.url)
			for (var x in data.tree) {
				var entry2 = data.tree[x]
				var types = [
					'Named_Boxarts',
					'Named_Titles',
					'Named_Snaps'
				]
				if (types.indexOf(entry2.path) >= 0) {
					var data2 = getData(entry2.url)
					var thumbsFromNew = dataToThumbnails(data2)
					for (var c in thumbsFromNew) {
						thumbs.push(system + '/' + entry2.path + '/' + thumbsFromNew[c])
					}
				}
			}
		}
	}
	return thumbs
}

/**
 * Download and cache the given URL.
 */
function getData(url) {
	var filename = '.tmp/' + sanitizeFilename(url + '.json')
	if (fileExists(filename)) {
		var contents = fs.readFileSync(filename, {
			encoding: 'utf8'
		})
		try {
			return JSON.parse(contents)
		}
		catch (err) {
			console.error(filename + '\n' + err)
			fs.unlink(filename)
		}
	}

	var contents = download(url + access)
	var json = JSON.parse(contents)
	if (json.message) {
		console.error(json.message)
		process.exit(1)
	}
	// Sleep so that we don't exceed GitHub's API limit.
	sleep.sleep(5)
	fs.writeFileSync(filename, contents)
	return json
}

/**
 * Convert a GitHub Data URL to a list of filenames.
 */
function dataToThumbnails(data) {
	var out = []
	for (var i in data.tree) {
		out.push(data.tree[i].path)
	}
	return out
}

module.exports = {
	processSystem: processSystem,
	writeReport: writeReport,
	thumbnails: thumbnails,
	getGameThumbnails: getGameThumbnails,
	cleanGameName: cleanGameName
}
