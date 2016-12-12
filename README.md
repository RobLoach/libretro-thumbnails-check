# libretro-thumbnails-check

Checks the consistancy of [libretro-thumbnails](https://github.com/libretro/libretro-thumbnails) against [libretro-database](https://github.com/libretro/libretro-database).

## Usage

1. See the [`out`](out) directory
2. All missing thumbs are reported in the system text file
3. Files that do not match a database entry are reported in the orphan file

## Build

1. Install all dependencies
  - `make`
  - `curl`
  - [Node.js](https://nodejs.org/en/)

2. Generate a [new GitHub Access Token](https://github.com/settings/tokens/new)
3. Edit `index.js` and add the access token in:
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
