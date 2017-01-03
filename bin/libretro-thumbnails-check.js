#!/usr/bin/env node

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
	files.forEach(function (file) {
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
		output = '# libretro-thumbnails-check Report'
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
		var total = totals.snap + totals.boxart + totals.title
		let totalPercent = ((total / (totals.total * 3)) * 100).toFixed(2)
		output += `\n\n## Total\n\n`
		output += `| Thumbnail | Total | Percent |
| :--- | :---: | ---: |
| Boxarts | ${totals.boxart} / ${totals.total} | ${(totals.boxart / totals.total * 100).toFixed(2)}% |
| Snaps | ${totals.snap} / ${totals.total} | ${(totals.snap / totals.total * 100).toFixed(2)}% |
| Titles | ${totals.title} / ${totals.total} | ${(totals.title / totals.total * 100).toFixed(2)}% |
| Total | ${total} / ${totals.total * 3} | **${totalPercent}%** |`

		for (let systemName in report) {
			let systemReport = report[systemName]
			var total = systemReport.snap + systemReport.boxart + systemReport.title
			totalPercent = ((total / (systemReport.total * 3)) * 100).toFixed(2)
			output += `\n\n## [${systemName}](${systemName}.txt)\n\n`
			output += `| Thumbnail | Total | Percent |
| :--- | :---: | ---: |
| Boxarts | ${systemReport.boxart} / ${systemReport.total} | ${(systemReport.boxart / systemReport.total * 100).toFixed(2)}% |
| Snaps | ${systemReport.snap} / ${systemReport.total} | ${(systemReport.snap / systemReport.total * 100).toFixed(2)}% |
| Titles | ${systemReport.title} / ${systemReport.total} | ${(systemReport.title / systemReport.total * 100).toFixed(2)}% |
| Total | ${total} / ${systemReport.total * 3} | **${totalPercent}%** |`

		}
		fs.writeFileSync('out/README.md', output)
	}).catch(function (err) {
		console.error(err);
	});
})
