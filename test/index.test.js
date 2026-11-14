'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
	cleanGameName,
	thumbnailRepo,
	thumbnails,
	getGameThumbnails,
	findInvalidThumbnails,
	writeReport,
	staleReports,
	matchKey,
	gameNames,
	renamedGames,
	thumbnailLinks,
	linkScript
} = require('..')
const datfile = require('robloach-datfile')
const { execFileSync } = require('child_process')

// Builds a regular file tree entry.
function file(filePath, size = 1000) {
	return { path: filePath, mode: '100644', type: 'blob', size: size, sha: 'sha-' + filePath }
}

// Builds a symlink tree entry.
function symlink(filePath, sha) {
	return { path: filePath, mode: '120000', type: 'blob', size: 10, sha: sha }
}

// Returns the paths reported for each invalid reason that has any.
function invalidPaths(invalid) {
	let result = {}
	for (let reason in invalid) {
		if (invalid[reason].length > 0) {
			result[reason] = invalid[reason].map((item) => item.path)
		}
	}
	return result
}

test('cleanGameName replaces the characters libretro replaces with _', () => {
	assert.strictEqual(cleanGameName('a&b*c/d:e`f<g>h?i\\j|k"l'), 'a_b_c_d_e_f_g_h_i_j_k_l')
	assert.strictEqual(cleanGameName('Tom & Jerry: Part 1 / 2'), 'Tom _ Jerry_ Part 1 _ 2')
	assert.strictEqual(cleanGameName('Super Mario Bros. (World) [!]'), 'Super Mario Bros. (World) [!]')
})

test('thumbnailRepo replaces spaces with underscores', () => {
	assert.strictEqual(thumbnailRepo('Nintendo - Game Boy'), 'Nintendo_-_Game_Boy')
	assert.strictEqual(thumbnailRepo('MrBoom'), 'MrBoom')
})

test('thumbnailRepo uses the repository overrides', () => {
	assert.strictEqual(thumbnailRepo("Jump 'n Bump"), 'Jump_n_Bump')
	assert.strictEqual(thumbnailRepo('Philips - Videopac+'), 'Philips_-_Videopac')
})

test('thumbnails returns the Named_* PNG paths as a Set', () => {
	let thumbs = thumbnails([
		file('Named_Boxarts/A.png'),
		file('Named_Snaps/A.png'),
		file('Named_Titles/A.png'),
		file('Named_Logos/A.png'),
		file('Named_Boxarts/B.jpg'),
		file('Named_Boxarts/Nested/C.png'),
		file('Boxarts/D.png'),
		file('README.md'),
		file('E.png')
	])
	assert.ok(thumbs instanceof Set)
	assert.deepStrictEqual([...thumbs].sort(), [
		'Named_Boxarts/A.png',
		'Named_Logos/A.png',
		'Named_Snaps/A.png',
		'Named_Titles/A.png'
	])
})

test('thumbnails handles a missing index', () => {
	assert.strictEqual(thumbnails(null).size, 0)
	assert.strictEqual(thumbnails([]).size, 0)
})

test('getGameThumbnails flags each thumbnail type the game has', () => {
	let thumbs = new Set(['Named_Boxarts/A.png', 'Named_Titles/A.png', 'Named_Logos/A.png', 'Named_Snaps/B.png'])
	assert.deepStrictEqual(getGameThumbnails(thumbs, 'System', 'A'), { boxart: true, title: true, logo: true })
	assert.deepStrictEqual(getGameThumbnails(thumbs, 'System', 'B'), { snap: true })
	assert.deepStrictEqual(getGameThumbnails(thumbs, 'System', 'C'), {})
})

test('findInvalidThumbnails returns an empty array for every reason', () => {
	let invalid = findInvalidThumbnails([file('Named_Boxarts/A.png')])
	assert.deepStrictEqual(Object.keys(invalid), ['notPng', 'badChars', 'tooSmall', 'unknownFolder', 'brokenSymlink'])
	assert.deepStrictEqual(invalidPaths(invalid), {})
	assert.deepStrictEqual(invalidPaths(findInvalidThumbnails(null)), {})
})

test('findInvalidThumbnails reports files without a lowercase .png extension', () => {
	let invalid = findInvalidThumbnails([
		file('Named_Boxarts/A.png'),
		file('Named_Boxarts/B.PNG'),
		file('Named_Snaps/C.jpg'),
		file('Named_Titles/D')
	])
	assert.deepStrictEqual(invalidPaths(invalid), {
		notPng: ['Named_Boxarts/B.PNG', 'Named_Snaps/C.jpg', 'Named_Titles/D']
	})
})

test('findInvalidThumbnails reports bad filename characters', () => {
	let invalid = findInvalidThumbnails([
		file('Named_Boxarts/Tom & Jerry.png'),
		file('Named_Snaps/A_ B.png'),
		file('Named_Titles/What?.png'),
		file('Named_Logos/A`B.png')
	])
	assert.deepStrictEqual(invalidPaths(invalid), {
		badChars: ['Named_Boxarts/Tom & Jerry.png', 'Named_Titles/What?.png', 'Named_Logos/A`B.png']
	})
})

test('findInvalidThumbnails reports empty and tiny files', () => {
	let invalid = findInvalidThumbnails([
		file('Named_Boxarts/Empty.png', 0),
		file('Named_Boxarts/Tiny.png', 99),
		file('Named_Boxarts/Fine.png', 100)
	])
	assert.deepStrictEqual(invalid.tooSmall, [
		{ path: 'Named_Boxarts/Empty.png', detail: '(0 bytes)' },
		{ path: 'Named_Boxarts/Tiny.png', detail: '(99 bytes)' }
	])
})

test('findInvalidThumbnails skips the size check when the size is unknown', () => {
	let entry = file('Named_Boxarts/A.png')
	delete entry.size
	assert.deepStrictEqual(invalidPaths(findInvalidThumbnails([entry])), {})
})

test('findInvalidThumbnails skips dotfiles', () => {
	let invalid = findInvalidThumbnails([
		file('Named_Boxarts/.gitkeep', 0),
		file('.gitignore', 0),
		file('.github/workflows/test.yml'),
		file('Named_Snaps/.hidden/A.png')
	])
	assert.deepStrictEqual(invalidPaths(invalid), {})
})

test('findInvalidThumbnails reports unknown and nested thumbnail folders', () => {
	let invalid = findInvalidThumbnails([
		file('Boxarts/A.png'),
		file('Named_Boxart/A.png'),
		file('named_snaps/A.png'),
		file('Named_Titles/Old/A.png'),
		file('Docs/A.png')
	])
	assert.deepStrictEqual(invalidPaths(invalid), {
		unknownFolder: ['Boxarts/A.png', 'Named_Boxart/A.png', 'named_snaps/A.png', 'Named_Titles/Old/A.png']
	})
})

test('findInvalidThumbnails ignores root files', () => {
	let invalid = findInvalidThumbnails([file('README.md', 10), file('LICENSE', 0), file('A.png', 0)])
	assert.deepStrictEqual(invalidPaths(invalid), {})
})

test('findInvalidThumbnails checks symlink targets', () => {
	let index = [
		file('Named_Boxarts/Target.png'),
		symlink('Named_Boxarts/Valid.png', 'valid'),
		symlink('Named_Snaps/Valid.png', 'validOtherFolder'),
		symlink('Named_Boxarts/Broken.png', 'broken'),
		symlink('Named_Boxarts/Outside.png', 'outside'),
		symlink('Named_Boxarts/Absolute.png', 'absolute'),
		symlink('Named_Boxarts/Unknown.png', 'unknown')
	]
	let invalid = findInvalidThumbnails(index, {
		valid: 'Target.png',
		validOtherFolder: '../Named_Boxarts/Target.png',
		broken: 'Missing.png',
		outside: '../../Target.png',
		absolute: '/etc/passwd'
	})
	assert.deepStrictEqual(invalid.brokenSymlink, [
		{ path: 'Named_Boxarts/Broken.png', detail: '-> Missing.png' },
		{ path: 'Named_Boxarts/Outside.png', detail: '-> ../../Target.png (outside the repository)' },
		{ path: 'Named_Boxarts/Absolute.png', detail: '-> /etc/passwd (outside the repository)' }
	])
	// A symlink's size is its target length, so symlinks are never too small.
	assert.deepStrictEqual(invalid.tooSmall, [])
})

test('findInvalidThumbnails skips symlinks without known targets', () => {
	let invalid = findInvalidThumbnails([symlink('Named_Boxarts/A.png', 'unknown')])
	assert.deepStrictEqual(invalidPaths(invalid), {})
})

test('findInvalidThumbnails still checks symlink names', () => {
	let invalid = findInvalidThumbnails([symlink('Named_Boxarts/A & B.PNG', 'unknown')])
	assert.deepStrictEqual(invalidPaths(invalid), {
		notPng: ['Named_Boxarts/A & B.PNG'],
		badChars: ['Named_Boxarts/A & B.PNG']
	})
})

test('writeReport counts thumbnails and writes orphans and invalid files', (t) => {
	let outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'libretro-thumbnails-check-test-'))
	t.after(() => fs.rmSync(outDir, { recursive: true, force: true }))

	let thumbs = new Set([
		'Named_Boxarts/Tom _ Jerry.png',
		'Named_Snaps/Tom _ Jerry.png',
		'Named_Logos/Other.png',
		'Named_Boxarts/Other.png',
		'Named_Boxarts/Orphan.png'
	])
	let games = {
		'Tom _ Jerry': { boxart: true, snap: true },
		'Other': { boxart: true, logo: true },
		'Missing': {}
	}
	let invalid = findInvalidThumbnails([file('Named_Boxarts/Bad.jpg', 0)])
	let count = writeReport('Test - System', games, thumbs, true, invalid, outDir)

	assert.deepStrictEqual(count, {
		boxart: 2,
		snap: 1,
		title: 0,
		logo: 1,
		invalid: 1,
		total: 3
	})
	assert.ok(fs.readFileSync(path.join(outDir, 'Test - System.txt'), 'utf8').startsWith('Test - System Missing\n\n'))
	assert.strictEqual(fs.readFileSync(path.join(outDir, 'Test - System Orphans.txt'), 'utf8'), 'Test - System Orphans\n\nNamed_Boxarts/Orphan.png')
	assert.strictEqual(fs.readFileSync(path.join(outDir, 'Test - System Invalid.txt'), 'utf8'), 'Test - System Invalid\n\nNot a PNG\n\nNamed_Boxarts/Bad.jpg\n\nEmpty or tiny files\n\nNamed_Boxarts/Bad.jpg (0 bytes)')

	// Matching every thumbnail, and fixing the invalid ones, removes the old files.
	games['Orphan'] = { boxart: true }
	count = writeReport('Test - System', games, thumbs, true, {}, outDir)
	assert.strictEqual(count.invalid, 0)
	assert.strictEqual(fs.existsSync(path.join(outDir, 'Test - System Orphans.txt')), false)
	assert.strictEqual(fs.existsSync(path.join(outDir, 'Test - System Invalid.txt')), false)
})

test('writeReport counts logos towards the total, listed before it', (t) => {
	let outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'libretro-thumbnails-check-test-'))
	t.after(() => fs.rmSync(outDir, { recursive: true, force: true }))

	let games = {
		'A': { boxart: true, snap: true, title: true, logo: true },
		'B': { snap: true, logo: true }
	}
	writeReport('Test', games, new Set(), true, {}, outDir)
	let summary = fs.readFileSync(path.join(outDir, 'Test.txt'), 'utf8').split('\n\n')[1]
	assert.strictEqual(summary, [
		'Boxarts  1/2   50.00%',
		'Snaps    2/2  100.00%',
		'Titles   1/2   50.00%',
		'Logos    2/2  100.00%',
		'Total    6/8   75.00%'
	].join('\n'))
})

test('writeReport counts missing logos as 0', (t) => {
	let outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'libretro-thumbnails-check-test-'))
	t.after(() => fs.rmSync(outDir, { recursive: true, force: true }))

	let count = writeReport('Test', { 'A': { boxart: true } }, new Set(), true, {}, outDir)
	assert.strictEqual(count.logo, 0)
	let output = fs.readFileSync(path.join(outDir, 'Test.txt'), 'utf8')
	assert.match(output, /Logos +0\/1 +0\.00%\nTotal +1\/4 +25\.00%/)
	assert.match(output, /A +- +✗ +✗ +✗/)
})

test('writeReport matches orphans by the cleaned game name', (t) => {
	let outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'libretro-thumbnails-check-test-'))
	t.after(() => fs.rmSync(outDir, { recursive: true, force: true }))

	writeReport('Test', { 'Tom & Jerry': { boxart: true } }, new Set(['Named_Boxarts/Tom _ Jerry.png']), true, {}, outDir)
	assert.strictEqual(fs.existsSync(path.join(outDir, 'Test Orphans.txt')), false)
})

test('writeReport marks systems without a thumbnail repository', (t) => {
	let outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'libretro-thumbnails-check-test-'))
	t.after(() => fs.rmSync(outDir, { recursive: true, force: true }))

	let count = writeReport('Philips - Videopac+', {}, new Set(), false, {}, outDir)
	assert.strictEqual(count.noRepo, true)
	assert.strictEqual(count.total, 0)
	let output = fs.readFileSync(path.join(outDir, 'Philips - Videopac+.txt'), 'utf8')
	assert.ok(output.includes('No thumbnails repository at https://github.com/libretro-thumbnails/Philips_-_Videopac'))
	assert.ok(output.includes('Error parsing dat files.'))
})

test('staleReports removes the reports of unknown systems', () => {
	let files = ['Atari - 8-bit.txt', 'Atari - 8-bit Orphans.txt', 'Atari - 8-bit Invalid.txt', 'Atari - 2600.txt']
	assert.deepStrictEqual(staleReports(files, ['Atari - 2600']), ['Atari - 8-bit.txt', 'Atari - 8-bit Orphans.txt', 'Atari - 8-bit Invalid.txt'])
})

test('staleReports keeps a known system and its Orphans and Invalid reports', () => {
	let files = ['Atari - 2600.txt', 'Atari - 2600 Orphans.txt', 'Atari - 2600 Invalid.txt']
	assert.deepStrictEqual(staleReports(files, ['Atari - 2600']), [])
})

test('staleReports only strips the Orphans and Invalid suffixes', () => {
	assert.deepStrictEqual(staleReports(['Atari - 2600 Other.txt', 'Atari - 2600 Orphans Invalid.txt'], ['Atari - 2600']), ['Atari - 2600 Other.txt', 'Atari - 2600 Orphans Invalid.txt'])
})

test('staleReports ignores files that are not .txt', () => {
	assert.deepStrictEqual(staleReports(['Atari - 8-bit.png', 'Atari - 8-bit.txt.bak', '.gitkeep'], ['Atari - 2600']), [])
})

test('staleReports handles a system whose name ends in Orphans', () => {
	let files = ['Test Orphans.txt', 'Test Orphans Orphans.txt', 'Test Orphans Invalid.txt']
	// The system "Test Orphans" keeps all of its reports.
	assert.deepStrictEqual(staleReports(files, ['Test Orphans']), [])
	// Its reports aren't mistaken for the orphans of a system named "Test".
	assert.deepStrictEqual(staleReports(files, ['Test']), ['Test Orphans Orphans.txt', 'Test Orphans Invalid.txt'])
	assert.deepStrictEqual(staleReports(files, []), files)
})

test('matchKey uses serials for disc systems', () => {
	assert.strictEqual(matchKey('Sony - PlayStation'), 'serial')
	assert.strictEqual(matchKey('Nintendo - Game Boy'), 'crc')
})

test('gameNames lets later DATs override earlier ones, like dat/ over metadat/', async () => {
	let metadat = await datfile.parse('game (\n\tname "Old Name (USA)"\n\trom ( name "a.gb" crc abcd1234 )\n)\ngame (\n\tname "Other (USA)"\n\trom ( name "b.gb" crc 11111111 )\n)\n')
	let dat = await datfile.parse('game (\n\tname "New Name (USA)"\n\trom ( name "a.gb" crc ABCD1234 )\n)\n')
	let names = gameNames([metadat, dat])
	assert.strictEqual(names.get('ABCD1234'), 'New Name (USA)')
	assert.strictEqual(names.get('11111111'), 'Other (USA)')
	assert.strictEqual(names.size, 2)
})

test('gameNames skips games without a name', () => {
	assert.strictEqual(gameNames([[{ comment: 'Game (USA)', entries: [{ crc: '9A024415' }] }]]).size, 0)
})

test('gameNames maps serials', () => {
	let names = gameNames([[{ name: 'Game (Japan)', serial: 'SLPS-01204', entries: [{ crc: '8ACD8FB1' }] }]], 'serial')
	assert.deepStrictEqual([...names], [['SLPS-01204', 'Game (Japan)']])
})

test('renamedGames compares CRCs case-insensitively', () => {
	let oldNames = gameNames([[{ name: 'A (USA)', entries: [{ crc: 'abcd1234' }] }, { name: 'Gone', entries: [{ crc: '22222222' }] }, { name: 'Same', entries: [{ crc: '33333333' }] }]])
	let newNames = gameNames([[{ name: 'A (USA, Europe)', entries: [{ crc: 'ABCD1234' }] }, { name: 'Same', entries: [{ crc: '33333333' }] }]])
	assert.deepStrictEqual(renamedGames(oldNames, newNames), [{ key: 'ABCD1234', from: 'A (USA)', to: 'A (USA, Europe)' }])
})

test('thumbnailLinks links the new name to the old image in each folder', () => {
	let links = thumbnailLinks([{ key: '1', from: 'Old', to: 'New' }], [
		file('Named_Boxarts/Old.png'),
		file('Named_Snaps/Old.png'),
		file('Named_Snaps/New.png'),
		file('Named_Logos/Other.png')
	])
	assert.deepStrictEqual(links, [{ path: 'Named_Boxarts/New.png', target: 'Old.png' }])
})

test('thumbnailLinks scrubs the names like RetroArch', () => {
	let links = thumbnailLinks([
		{ key: '1', from: 'Tom & Jerry: A', to: 'Tom & Jerry: B' },
		{ key: '2', from: 'C?', to: 'C*' }
	], [file('Named_Titles/Tom _ Jerry_ A.png'), file('Named_Titles/C_.png')])
	assert.deepStrictEqual(links, [{ path: 'Named_Titles/Tom _ Jerry_ B.png', target: 'Tom _ Jerry_ A.png' }])
})

test('thumbnailLinks only adds each link once', () => {
	let links = thumbnailLinks([
		{ key: '1', from: 'A', to: 'New' },
		{ key: '2', from: 'B', to: 'New' }
	], [file('Named_Boxarts/A.png'), file('Named_Boxarts/B.png')])
	assert.deepStrictEqual(links, [{ path: 'Named_Boxarts/New.png', target: 'A.png' }])
})

test('thumbnailLinks links to the final target of a symlink', () => {
	let index = [
		symlink('Named_Boxarts/Old.png', 'sha-old'),
		symlink('Named_Boxarts/Middle.png', 'sha-middle'),
		file('Named_Boxarts/Real.png'),
		symlink('Named_Snaps/Old.png', 'sha-broken'),
		symlink('Named_Titles/Old.png', 'sha-unknown'),
		symlink('Named_Logos/Old.png', 'sha-loop')
	]
	let targets = {
		'sha-old': 'Middle.png',
		'sha-middle': '../Named_Boxarts/Real.png',
		'sha-broken': 'Missing.png',
		'sha-loop': 'Old.png'
	}
	assert.deepStrictEqual(thumbnailLinks([{ key: '1', from: 'Old', to: 'New' }], index, targets), [
		{ path: 'Named_Boxarts/New.png', target: 'Real.png' },
		// The target is unknown, so it links to the symlink itself.
		{ path: 'Named_Titles/New.png', target: 'Old.png' }
	])
})

test('thumbnailLinks handles a missing index', () => {
	assert.deepStrictEqual(thumbnailLinks([{ key: '1', from: 'Old', to: 'New' }], null), [])
})

test('linkScript adds each link to the git index as a symlink', () => {
	let script = linkScript('Nintendo - Game Boy', [{ path: "Named_Boxarts/Tom's Game.png", target: 'Old.png' }])
	assert.ok(script.startsWith('#!/bin/sh\n'))
	assert.ok(script.includes('git clone --filter=blob:none --sparse https://github.com/libretro-thumbnails/Nintendo_-_Game_Boy.git'))
	assert.ok(script.includes('git update-index --add --cacheinfo "120000,$blob,$1"'))
	assert.ok(script.endsWith("link 'Named_Boxarts/Tom'\\''s Game.png' 'Old.png'\n"))
})

test('linkScript runs in a git repository', (t) => {
	let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'links-test-'))
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
	execFileSync('git', ['init', '--quiet', dir])
	fs.writeFileSync(path.join(dir, 'links.sh'), linkScript('MrBoom', [{ path: "Named_Boxarts/Tom's & Game.png", target: 'Old Name.png' }]))
	execFileSync('sh', ['links.sh'], { cwd: dir })
	let entry = execFileSync('git', ['ls-files', '-s'], { cwd: dir, encoding: 'utf8' }).trim()
	assert.match(entry, /^120000 [0-9a-f]+ 0\tNamed_Boxarts\/Tom's & Game.png$/)
	let blob = entry.split(' ')[1]
	assert.strictEqual(execFileSync('git', ['cat-file', 'blob', blob], { cwd: dir, encoding: 'utf8' }), 'Old Name.png')
})
