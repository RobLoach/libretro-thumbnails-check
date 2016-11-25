report.txt: libretro-thumbnails.json libretro-database/dat/BIOS.dat
	@node --stack-size=1000000000 index.js

libretro-thumbnails.json:
	curl -o tree.json https://api.github.com/repos/libretro/libretro-thumbnails/git/trees/master?recursive=1

libretro-database/dat/BIOS.dat:
	git submodule init
	git submodule update
