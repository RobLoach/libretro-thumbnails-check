// Dependencies
var path = require('path')
var fs = require('fs')
var glob = require('glob')
var globby = require('globby')
var datfile = require('datfile')
var minimatch = require('minimatch')
var table = require('text-table')
var download = require('download-file-sync')
var fileExists = require('file-exists')
var sanitizeFilename = require('sanitize-filename')
var sleep = require('sleep')
var batchreplace = require('batchreplace')

// Construct the thumbnail cleaner.
var thumbnailReplacer = batchreplace.mapReplacer({
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

var access = ''
//var access = '?access_token='

glob('libretro-database/rdb/*.rdb', function (err, files) {
	files.forEach(function (file) {
		var system = path.parse(file).name
		processSystem(system)
	})
})

function processSystem(system) {
	if (fileExists('out/' + system + '.txt')) {
		return true
	}
	var patterns = [
		// @TODO Figure out why GoodTools breaks compilation.
		//'libretro-database/metadat/goodtools/' + system + '.dat',
		'libretro-database/metadat/libretro-dats/' + system + '.dat',
		'libretro-database/metadat/no-intro/' + system + '.dat',
		'libretro-database/dat/' + system + '.dat'
	]
	globby(patterns).then(function (paths) {
		var games = {}
		for (var i in paths) {
			var file = paths[i]
			var data = fs.readFileSync(file, 'utf8')
			var dat = datfile.parse(data)
			for (var x in dat) {
				var game = dat[x]
				games[game.name] = getGameThumbnails(system, game.name)
			}
		}
		writeReport(system, games)
	}).catch(function (err) {
		console.log(err)
	})
}

function getGameThumbnails(system, name) {
	var thumbs = thumbnails(system)
	var thumbnailName = thumbnailReplacer(name)
	var out = minimatch.match(thumbs, system + '/*/' + thumbnailName + '.png', {matchBase: true})
	var result = {}
	for (var i in out) {
		var str = out[i]
		if (str.indexOf('Named_Boxarts') > 0) {
			result.boxart = true
		}
		else if (str.indexOf('Named_Snaps') > 0) {
			result.snap = true
		}
		else if (str.indexOf('Named_Titles') > 0) {
			result.title = true
		}
	}
	return result
}

function writeReport(system, games) {
	var output = system + '\n\n'
	if (games.length <= 0) {
		output += 'Error parsing dat files.'
	}
	else {
		var entries = []
		entries.push(['Name', 'Boxart', 'Snap', 'Title'])
		for (var gameName in games) {
			var game = games[gameName]
			var boxart = game.boxart ? '✓' : '✗'
			var snap = game.snap ? '✓' : '✗'
			var title = game.title ? '✓' : '✗'
			entries.push([gameName, boxart, snap, title])
		}
		output += table(entries, {
			align: ['l', 'c', 'c', 'c']
		})
	}
	fs.writeFileSync('out/' + system + '.txt', output)
}

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

function getData(url) {
	var filename = '.tmp/' + sanitizeFilename(url + '.json')
	if (fileExists(filename)) {
		var contents = fs.readFileSync(filename, {
			encoding: 'utf8'
		})
		return JSON.parse(contents)
	}

	var contents = download(url + access)
	// Sleep so that we don't exceed GitHub's API limit.
	sleep.sleep(5)
	fs.writeFileSync(filename, contents)
	return JSON.parse(contents)
}

function dataToThumbnails(data) {
	var out = []
	for (var i in data.tree) {
		out.push(data.tree[i].path)
	}
	return out
}
