default: libretro-database/dat/BIOS.dat out node_modules
	npm run report

node_modules:
	npm install

out:
	mkdir -p out

libretro-database/dat/BIOS.dat:
	git submodule init
	git submodule update

clean:
	rm -rf out node_modules
