default: .tmp libretro-database/dat/BIOS.dat out node_modules
	#@node --stack-size=1000000000 index.js
	npm test

node_modules:
	npm install

out:
	mkdir -p out

.tmp:
	mkdir -p .tmp

libretro-database/dat/BIOS.dat:
	git submodule init
	git submodule update

clean:
	rm -rf .tmp out node_modules
