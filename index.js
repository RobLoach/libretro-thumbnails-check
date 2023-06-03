'use strict'

// Dependencies
var path = require('path')
var pkg = require('./package.json')
var fs = require('fs')
var glob = require('glob')
var globby = require('globby')
var datfile = require('robloach-datfile')
var minimatch = require('minimatch')
var table = require('text-table')
var fileExists = require('file-exists')
var sanitizeFilename = require('sanitize-filename')
var batchreplace = require('batchreplace')
var sort = require('sort-object-keys')
var Listr = require('listr')
var exists = require('fs-exists-sync')
var recursiveReadDirSync = require('recursive-readdir-sync')

// Set the location where libretro-thumbnails is.
var libretroThumbnailsPath = pkg.config['libretro-thumbnails-path']

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
	var result = {}

	if (thumbs.includes(`Named_Boxarts/${name}.png`)) {
		result.boxart = true
	}
	if (thumbs.includes(`Named_Snaps/${name}.png`)) {
		result.snap = true
	}
	if (thumbs.includes(`Named_Titles/${name}.png`)) {
		result.title = true
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
	let output = system + ' Missing\n\n'
	let count = {
		boxart: 0,
		snap: 0,
		title: 0,
		total: Object.keys(games).length
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

		let orphans = ''
		for (let o in thumbs) {
			// Ignore the .git folder.
			if (thumbs[o].indexOf('.git') < 0 && thumbs[o].indexOf('.travis.') < 0 && thumbs[o] != '.travis.yml') {
				orphans += '\n' + thumbs[o].replace(system + '/', '').replace(libretroThumbnailsPath, '')
			}
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

	const fileName = `${__dirname}/indexFiles/${system}.index`

	let content = fs.readFileSync(fileName, 'utf8')

	let files = content.split('\n').filter(Boolean)

	// let filePath = path.join(libretroThumbnailsPath, system)
	// try {
	// 	files = recursiveReadDirSync(filePath)
	// }
	// catch (err) {
	// 	// Nothing.
	// }
	// for (let i in files) {
	// 	files[i] = files[i].replace(libretroThumbnailsPath + '/', '')
	// }
	return files
}

module.exports = {
	processSystem: processSystem,
	writeReport: writeReport,
	thumbnails: thumbnails,
	getGameThumbnails: getGameThumbnails,
	cleanGameName: cleanGameName
}
