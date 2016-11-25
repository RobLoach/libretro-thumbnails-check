report.txt: libretro-thumbnails.json libretro-database/dat/BIOS.dat out node_modules
	@node --stack-size=1000000000 index.js

node_modules:
	npm install

out:
	mkdir -p out

libretro-thumbnails.json:
	curl -o tree.json https://api.github.com/repos/libretro/libretro-thumbnails/git/trees/master?recursive=1

libretro-database/dat/BIOS.dat:
	git submodule init
	git submodule update
