#!/usr/bin/env node
'use strict'

var fs = require('fs')
var path = require('path')
var glob = require('glob')
var Listr = require('listr')
var processSystem = require('..').processSystem
var writeReport = require('..').writeReport
var thumbnails = require('..').thumbnails
var hasLogos = require('..').hasLogos
var getGameThumbnails = require('..').getGameThumbnails
var cleanGameName = require('..').cleanGameName
var fetchThumbnailIndex = require('..').fetchThumbnailIndex
var checkGitHubAuth = require('..').checkGitHubAuth
var findInvalidThumbnails = require('..').findInvalidThumbnails
var fetchSymlinkTargets = require('..').fetchSymlinkTargets
var staleReports = require('..').staleReports

// Pass --system "<name>" (repeatable) to only check the given systems.
var onlySystems = []
var args = process.argv.slice(2)
for (var i = 0; i < args.length; i++) {
	if (args[i] == '--system' && i + 1 < args.length) {
		onlySystems.push(args[++i])
	}
	else if (args[i].startsWith('--system=')) {
		onlySystems.push(args[i].slice('--system='.length))
	}
	else {
		console.error(`Unknown argument: ${args[i]}\nUsage: libretro-thumbnails-check [--system "<name>"]...`)
		process.exit(1)
	}
}

// Resolve all paths relative to the project root, not the working directory.
var root = path.join(__dirname, '..')

// Percentage of a count, or 0 when there is nothing to count.
function percent(count, total) {
	return (total > 0 ? (count / total) * 100 : 0).toFixed(2)
}

glob('libretro-database/rdb/*.rdb', { cwd: root }, async function (err, files) {
	if (err) {
		console.error(err)
		process.exit(1)
	}

	if (onlySystems.length > 0) {
		let known = new Set(files.map((file) => path.parse(file).name))
		let unknown = onlySystems.filter((system) => !known.has(system))
		if (unknown.length > 0) {
			console.error(`Unknown system(s): ${unknown.join(', ')}`)
			process.exit(1)
		}
		files = files.filter((file) => onlySystems.includes(path.parse(file).name))
	}

	// Fail early when GitHub can't be reached or the token is missing or invalid.
	try {
		await checkGitHubAuth()
	}
	catch (error) {
		console.error(error.message)
		process.exit(1)
	}

	// Systems that failed, mapped to their error message.
	var failed = {}

	// Thumbnail index of each system, or null when it has no thumbnail repository.
	var indexes = {}

	// Symlink targets of each system, by blob sha.
	var symlinkTargets = {}

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
					try {
						indexes[system] = await fetchThumbnailIndex(system)
					}
					catch (error) {
						failed[system] = `Index fetch failed: ${error.message}`
						return reject(new Error(`${system}: ${failed[system]}`))
					}
					try {
						symlinkTargets[system] = await fetchSymlinkTargets(system, indexes[system])
						resolve()
					}
					catch (error) {
						// Without the targets, broken symlinks just aren't reported.
						console.warn(`${system}: Symlink fetch failed: ${error.message}`)
						resolve()
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
						let thumbs = thumbnails(indexes[system])
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
						let invalid = findInvalidThumbnails(indexes[system], symlinkTargets[system])
						context[system] = writeReport(system, output, thumbs, indexes[system] !== null, hasLogos(indexes[system]), invalid)
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
			invalid: 0,
			total: 0,
			// Logos are only counted for systems that have a Named_Logos directory.
			logo: 0,
			logoTotal: 0
		}
		for (let systemName in report) {
			let systemReport = report[systemName]
			// Systems without a thumbnail repository don't count towards the total.
			if (systemReport.noRepo) {
				continue
			}
			totals.boxart += systemReport.boxart
			totals.snap += systemReport.snap
			totals.title += systemReport.title
			totals.invalid += systemReport.invalid
			totals.total += systemReport.total
			if (systemReport.hasLogos) {
				totals.logo += systemReport.logo
				totals.logoTotal += systemReport.total
			}
		}
		var titletotal = totals.snap + totals.boxart + totals.title
		let totalTotalPercent = percent(titletotal, totals.total * 3)
		let totalLogos = totals.logoTotal > 0 ? `**${totals.logo} / ${totals.logoTotal}**` : '-'
		output += `| System | Boxarts | Snaps | Titles | Logos | Invalid | Total | Percent |\n`
		output += `| :--- | :---: | :---: | :---: | :---: | :---: | :---: | ---: |\n`
		for (let systemName in report) {
			let systemReport = report[systemName]
			let total = systemReport.snap + systemReport.boxart + systemReport.title
			let totalPercent = systemReport.noRepo ? 'No thumbnails repo' : `**${percent(total, systemReport.total * 3)}%**`
			// Logos are shown on their own, and left out of the total and percent.
			let logos = systemReport.hasLogos ? `${systemReport.logo} / ${systemReport.total}` : '-'
			var urlName = systemName.split(' ').join('%20')
			let invalid = systemReport.invalid > 0 ? `[${systemReport.invalid}](out/${urlName}%20Invalid.txt)` : 0
			output += `| [${systemName}](out/${urlName}.txt) | ${systemReport.boxart} / ${systemReport.total} | ${systemReport.snap} / ${systemReport.total} | ${systemReport.title} / ${systemReport.total} | ${logos} | ${invalid} | ${total} / ${systemReport.total * 3} | ${totalPercent} |\n`
		}
		output += `| **Total** | **${totals.boxart} / ${totals.total}** | **${totals.snap} / ${totals.total}** | **${totals.title} / ${totals.total}** | ${totalLogos} | **${totals.invalid}** | **${titletotal} / ${totals.total * 3}** | **${totalTotalPercent}%** |`

		var contents = fs.readFileSync(path.join(root, '.README.template.md'), {encoding:'utf8'})
		contents = contents.replace('{{ contents }}', output)
		contents = contents.replace('{{ date }}', new Date().toISOString().slice(0, 10))
		fs.writeFileSync(path.join(root, 'README.md'), contents)

		// On a full run, remove the reports of systems no longer in the database.
		// Failed systems are still in the database, so their reports are kept.
		if (onlySystems.length == 0 && files.length > 0) {
			let outDir = path.join(root, 'out')
			let reportFiles = fs.existsSync(outDir) ? fs.readdirSync(outDir, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name) : []
			let stale = staleReports(reportFiles, files.map((file) => path.parse(file).name))
			if (stale.length > 0) {
				console.log(`\nRemoved ${stale.length} stale report(s):`)
				for (let fileName of stale) {
					fs.unlinkSync(path.join(outDir, fileName))
					console.log(`- out/${fileName}`)
				}
			}
		}

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
