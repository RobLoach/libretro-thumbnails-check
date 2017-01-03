# libretro-thumbnails-check

Checks the consistancy of [libretro-thumbnails](https://github.com/libretro/libretro-thumbnails) against [libretro-database](https://github.com/libretro/libretro-database).

## Usage

1. See the [Report in the `out` directory](https://github.com/RobLoach/libretro-thumbnails-check/blob/master/out/README.md#libretro-thumbnails-check-report)
2. All missing thumbs are reported in the system text file
3. Files that do not match a database entry are reported in the orphan files

## Build

1. Install all dependencies
  - `make`
  - `curl`
  - [Node.js](https://nodejs.org/en/)

2. Generate a [new GitHub Access Token](https://github.com/settings/tokens/new)
3. Edit `bin/libretro-thumbnails-check.js` and add the access token in:
  ```
  // Set the GitHub access token below.
  //var access = ''
  var access = '?access_token=dsafklh1321jk3hlh11lnkd1'
  ```

4. Run the following to build the out directory
  ```
  make clean
  make
  ```
