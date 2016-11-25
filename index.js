var path = require('path')
var fs = require('fs')
var glob = require('glob')
var globby = require('globby')
var datfile = require('datfile')
var minimatch = require('minimatch')
var thumbnails = thumbnails()
var final = {}

glob('libretro-database/rdb/*.rdb', function (err, files) {
	files.forEach(function (file) {
		var system = path.parse(file).name
		processSystem(system)
	})
})

function processSystem(system) {
	final[system] = {}
	var patterns = [
		'libretro-database/metadat/goodtools/' + system + '.dat',
		'libretro-database/metadat/libretro-dats/' + system + '.dat',
		'libretro-database/metadat/no-intro/' + system + '.dat',
		'libretro-database/dat/' + system + '.dat'
	]
	globby(patterns).then(function (paths) {
		var games = []
		//console.log('\n--------------\n' + system)
		for (var i in paths) {
			var file = paths[i]
			var data = fs.readFileSync(file, 'utf8')
			var dat = datfile.parse(data)
			for (var x in dat) {
				var game = dat[x]
				testGame(system, game.name)
			}
		}
		writeReport(final)
	})
}

function testGame(system, name) {
	var out = minimatch.match(thumbnails, system + '/*/' + name + '.png', {matchBase: true})
	final[system][name] = {}
	for (var i in out) {
		var str = out[i]
		if (str.indexOf('Named_Boxarts') > 0) {
			final[system][name].Boxart = true
		}
		else if (str.indexOf('Named_Snaps') > 0) {
			final[system][name].Snap = true
		}
		else if (str.indexOf('Named_Titles') > 0) {
			final[system][name].Title = true
		}
	}
}

function writeReport(final) {
	var out = '# Report'
	var yes = ':white_check_mark:'
	var no = ':white_medium_square:'

	for (var systemName in final) {
		out += '\n\n## ' + systemName + '\n\n'
		if (Object.keys(final[systemName]).length === 0) {
			out += 'Error loading dat files.'
		}
		else {
			out += '| Game | Boxart | Snap | Title |\n'
			out += '| ---- | ------ | ---- | ----- |\n'
			for (var gameName in final[systemName]) {
				var game = final[systemName][gameName]
				var boxart = game.Boxart ? yes : no
				var snap = game.Snap ? yes : no
				var title = game.Title ? yes : no
				out += `| ${gameName} | ${boxart} | ${snap} | ${title} |\n`
			}
		}
	}
	fs.writeFileSync('report.md', out)
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
