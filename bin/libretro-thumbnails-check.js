#!/usr/bin/env node
'use strict'

var fs = require('fs')
var path = require('path')
var glob = require('glob')
var Listr = require('listr')
var processSystem = require('..').processSystem
var writeReport = require('..').writeReport
var thumbnails = require('..').thumbnails
var getGameThumbnails = require('..').getGameThumbnails
var cleanGameName = require('..').cleanGameName

glob('libretro-database/rdb/*.rdb', function (err, files) {
	// Create the task runner.
	var tasks = new Listr([], {
		concurrent: false
	})
	files.forEach((file) => {
		'use strict'
		// Add the system task.
		let system = path.parse(file).name
		tasks.add({
			title: system,
			task: function (context) {
				return new Promise(function (resolve, reject) {
					processSystem(system).then(function (fileResult) {
						// Load up all the defined games across all the DAT files.
						let games = []
						for (var fileResultIndex in fileResult) {
							var entries = fileResult[fileResultIndex]
							for (var x in entries) {
								let game = entries[x]
								games.push(game.name)
							}
						}

						// If there are any games.
						if (games.length > 0) {
							let output = {}
							// Load the system thumbnails.
							let thumbs = thumbnails(system)
							let gameName = null
							let gameIndex = 0
							// Loop through each game and fill in the thumbnail data.
							for (gameIndex in games) {
								gameName = cleanGameName(games[gameIndex])
								if (!output[gameName]) {
									output[gameName] = getGameThumbnails(thumbs, system, gameName)
								}
							}
							let totals = writeReport(system, output, thumbs)
							context[system] = totals
						}
						return resolve()
					}).catch(function (err) {
						reject(err)
					})
				})
			}
		})
	})
	tasks.run().then(function (report) {
		let output = ''
		let totals = {
			boxart: 0,
			snap: 0,
			title: 0,
			total: 0
		}
		for (let systemName in report) {
			let systemReport = report[systemName]
			totals.boxart += systemReport.boxart
			totals.snap += systemReport.snap
			totals.title += systemReport.title
			totals.total += systemReport.total
		}
		var titletotal = totals.snap + totals.boxart + totals.title
		let totalTotalPercent = ((titletotal / (totals.total * 3)) * 100).toFixed(2)
		output += `| System | Boxarts | Snaps | Titles | Total | Percent |\n`
		output += `| :--- | :---: | :---: | :---: | :---: | ---: |\n`
		for (let systemName in report) {
			let systemReport = report[systemName]
			let total = systemReport.snap + systemReport.boxart + systemReport.title
			let totalPercent = ((total / (systemReport.total * 3)) * 100).toFixed(2)
			var urlName = systemName.split(' ').join('%20')
			output += `| [${systemName}](out/${urlName}.txt) | ${systemReport.boxart} / ${systemReport.total} | ${systemReport.snap} / ${systemReport.total} | ${systemReport.title} / ${systemReport.total} | ${total} / ${systemReport.total * 3} | **${totalPercent}%** |\n`
		}
		output += `| **Total** | **${totals.boxart} / ${totals.total}** | **${totals.snap} / ${totals.total}** | **${totals.title} / ${totals.total}** | **${titletotal} / ${totals.total * 3}** | **${totalTotalPercent}%** |`

		var contents = fs.readFileSync('.README.template.md', {encoding:'utf8'})
		contents = contents.replace('{{ contents }}', output)
		fs.writeFileSync('README.md', contents)
	}).catch(function (err) {
		console.error(err);
	});
})
