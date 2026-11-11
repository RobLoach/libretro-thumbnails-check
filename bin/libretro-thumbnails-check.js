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
var fetchThumbnailIndex = require('..').fetchThumbnailIndex

// Pass --refresh to ignore cached index files and fetch them again.
var refresh = process.argv.includes('--refresh')

// Resolve all paths relative to the project root, not the working directory.
var root = path.join(__dirname, '..')

// Percentage of a count, or 0 when there is nothing to count.
function percent(count, total) {
	return (total > 0 ? (count / total) * 100 : 0).toFixed(2)
}

glob('libretro-database/rdb/*.rdb', { cwd: root }, function (err, files) {
	if (err) {
		console.error(err)
		process.exit(1)
	}

	// Systems that failed, mapped to their error message.
	var failed = {}

	// Create the task runner.
	var tasks = new Listr([], {
		concurrent: false,
		exitOnError: false
	})
	files.forEach((file) => {
		'use strict'
		// Add the system task.
		let system = path.parse(file).name
		tasks.add({
			title: system + ' Index',
			task: function(context) {
				return new Promise(async function (resolve, reject) {
					const indexFile = path.join(root, 'indexFiles', system + '.index')
					if (!refresh && fs.existsSync(indexFile)) {
						return resolve()
					}

					try {
						let files = await fetchThumbnailIndex(system)
						fs.mkdirSync(path.dirname(indexFile), { recursive: true })
						fs.writeFileSync(indexFile, files.join('\n'))
						resolve()
					}
					catch (error) {
						failed[system] = `Index fetch failed: ${error.message}`
						reject(new Error(`${system}: ${failed[system]}`))
					}
				})
			}
		})
		tasks.add({
			title: system,
			skip: function () {
				if (failed[system]) {
					return 'Skipped: index unavailable'
				}
			},
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
						// Systems with no games are still reported, with zero counts.
						context[system] = writeReport(system, output, thumbs)
						return resolve()
					}).catch(function (err) {
						failed[system] = err.message
						reject(err)
					})
				})
			}
		})
	})
	tasks.run().catch(function (err) {
		// With exitOnError disabled, the context of the successful systems is still available.
		if (err.errors && err.context) {
			return err.context
		}
		throw err
	}).then(function (report) {
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
		let totalTotalPercent = percent(titletotal, totals.total * 3)
		output += `| System | Boxarts | Snaps | Titles | Total | Percent |\n`
		output += `| :--- | :---: | :---: | :---: | :---: | ---: |\n`
		for (let systemName in report) {
			let systemReport = report[systemName]
			let total = systemReport.snap + systemReport.boxart + systemReport.title
			let totalPercent = percent(total, systemReport.total * 3)
			var urlName = systemName.split(' ').join('%20')
			output += `| [${systemName}](out/${urlName}.txt) | ${systemReport.boxart} / ${systemReport.total} | ${systemReport.snap} / ${systemReport.total} | ${systemReport.title} / ${systemReport.total} | ${total} / ${systemReport.total * 3} | **${totalPercent}%** |\n`
		}
		output += `| **Total** | **${totals.boxart} / ${totals.total}** | **${totals.snap} / ${totals.total}** | **${totals.title} / ${totals.total}** | **${titletotal} / ${totals.total * 3}** | **${totalTotalPercent}%** |`

		var contents = fs.readFileSync(path.join(root, '.README.template.md'), {encoding:'utf8'})
		contents = contents.replace('{{ contents }}', output)
		contents = contents.replace('{{ date }}', new Date().toISOString().slice(0, 10))
		fs.writeFileSync(path.join(root, 'README.md'), contents)

		let failedSystems = Object.keys(failed)
		if (failedSystems.length > 0) {
			console.error(`\n${failedSystems.length} system(s) failed:`)
			for (let systemName of failedSystems) {
				console.error(`- ${systemName}: ${failed[systemName]}`)
			}
			process.exitCode = 1
		}
	}).catch(function (err) {
		console.error(err)
		process.exitCode = 1
	})
})
