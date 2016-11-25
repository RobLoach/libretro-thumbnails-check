var path = require('path')
var fs = require('fs')
var glob = require('glob')
var globby = require('globby')
var datfile = require('datfile')
var minimatch = require('minimatch')
var table = require('text-table')
var thumbnails = thumbnails()

glob('libretro-database/rdb/*.rdb', function (err, files) {
	files.forEach(function (file) {
		var system = path.parse(file).name
		processSystem(system)
	})
})

function processSystem(system) {
	var patterns = [
		'libretro-database/metadat/goodtools/' + system + '.dat',
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
	})
}

function getGameThumbnails(system, name) {
	var out = minimatch.match(thumbnails, system + '/*/' + name + '.png', {matchBase: true})
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
			align: ['l', 'r', 'r', 'r']
		})
	}
	fs.writeFileSync('out/' + system + '.txt', output)
}

function thumbnails() {
	var thumbnails = []
	var all = require('./libretro-thumbnails.json')
	for (var i in all.tree) {
		var entry = all.tree[i]
		if (entry.type == 'blob') {
			thumbnails.push(entry.path)
		}
	}
	return thumbnails
}
