// File: scripts/build-exe.js
// Builds a single, self-contained Windows .exe for this app using Node's
// built-in Single Executable Application (SEA) support, so the exact same
// node:sqlite-capable runtime is embedded — no separate Node.js install
// needed on the machine(s) that run the .exe.
//
// views/, public/, assets/ and a default .env template are embedded into the
// .exe itself (see src/utils/embeddedAssets.js, which self-extracts them next
// to the .exe on startup) — so the only thing that needs to be copied around
// is the single .exe file.
//
// Usage: npm run build:exe
// Output: dist/UserProvisioning.exe (plus dist/bundle.js, dist/sea-prep.blob as intermediates)
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { Jimp } = require('jimp');
const pngToIco = require('png-to-ico').default;
const { rcedit } = require('rcedit');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const BUNDLE_FILE = path.join(DIST, 'bundle.js');
const BLOB_FILE = path.join(DIST, 'sea-prep.blob');
const SEA_CONFIG_FILE = path.join(DIST, 'sea-config.json');
const EMBEDDED_ASSETS_FILE = path.join(DIST, 'embedded-assets.json');
const EXE_NAME = 'UserProvisioning.exe';
const EXE_FILE = path.join(DIST, EXE_NAME);
const SENTINEL_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const DEPLOY = path.join(ROOT, 'deploy');
const EMBED_DIRS = ['views', 'public', 'assets'];
const ICON_SOURCE = path.join(ROOT, 'assets', 'logo-source.png');
const ICON_FILE = path.join(DIST, 'icon.ico');

function run(cmd, args) {
  console.log('> ' + cmd + ' ' + args.join(' '));
  execFileSync(cmd, args, { stdio: 'inherit' });
}

function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.cpSync(src, dest, { recursive: true });
}

function collectFiles(dir, baseDir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, baseDir, out);
    } else {
      const rel = path.relative(baseDir, full).split(path.sep).join('/');
      out[rel] = fs.readFileSync(full).toString('base64');
    }
  });
}

function buildEmbeddedAssetsManifest() {
  const manifest = {};
  EMBED_DIRS.forEach(function (dir) {
    const full = path.join(ROOT, dir);
    if (fs.existsSync(full)) collectFiles(full, ROOT, manifest);
  });
  return manifest;
}

// The base .exe is a raw copy of node.exe, so it carries Node's own icon
// unless we overwrite it — pad the (non-square) source logo onto a square
// canvas, render it at the standard Windows icon sizes, and pack those into
// a single multi-resolution .ico for rcedit to set as the exe's resource icon.
async function buildIconIco() {
  if (!fs.existsSync(ICON_SOURCE)) return null;
  const src = await Jimp.read(ICON_SOURCE);
  const size = Math.max(src.bitmap.width, src.bitmap.height);
  const square = new Jimp({ width: size, height: size, color: 0xffffffff });
  square.composite(src, Math.round((size - src.bitmap.width) / 2), Math.round((size - src.bitmap.height) / 2));

  const pngFiles = await Promise.all([256, 48, 32, 16].map(async function (s) {
    const p = path.join(DIST, 'icon-' + s + '.png');
    await square.clone().resize({ w: s, h: s }).write(p);
    return p;
  }));
  const icoBuffer = await pngToIco(pngFiles);
  fs.writeFileSync(ICON_FILE, icoBuffer);
  return ICON_FILE;
}

async function main() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  console.log('\n[1/6] Bundling server code with esbuild...');
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'server.js')],
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    outfile: BUNDLE_FILE,
    logLevel: 'info'
  });

  console.log('\n[2/6] Embedding views/public/assets and the default .env template...');
  const manifest = buildEmbeddedAssetsManifest();
  fs.writeFileSync(EMBEDDED_ASSETS_FILE, JSON.stringify(manifest));
  console.log('Embedded ' + Object.keys(manifest).length + ' files (' +
    Math.round(fs.statSync(EMBEDDED_ASSETS_FILE).size / 1024) + ' KB manifest).');

  console.log('\n[3/6] Generating SEA blob...');
  fs.writeFileSync(SEA_CONFIG_FILE, JSON.stringify({
    main: BUNDLE_FILE,
    output: BLOB_FILE,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
    assets: {
      'embedded-assets.json': EMBEDDED_ASSETS_FILE,
      'env-template': path.join(ROOT, '.env.example')
    }
  }, null, 2));
  run(process.execPath, ['--experimental-sea-config', SEA_CONFIG_FILE]);

  console.log('\n[4/6] Copying node.exe as the base executable...');
  fs.copyFileSync(process.execPath, EXE_FILE);

  console.log('\n[5/6] Setting the executable icon from assets/logo-source.png...');
  const iconFile = await buildIconIco();
  if (iconFile) {
    await rcedit(EXE_FILE, { icon: iconFile });
    console.log('Icon set.');
  } else {
    console.log('No assets/logo-source.png found — keeping the default Node.js icon.');
  }

  console.log('\n[6/6] Injecting the app blob into the executable (postject)...');
  run(process.execPath, [
    path.join(ROOT, 'node_modules', 'postject', 'dist', 'cli.js'),
    EXE_FILE,
    'NODE_SEA_BLOB',
    BLOB_FILE,
    '--sentinel-fuse', SENTINEL_FUSE,
    '--overwrite'
  ]);

  console.log('\nAssembling deploy/ folder (for local testing; the .exe alone is what needs to travel)...');
  // views/public/assets are embedded — deploy/ only needs the .exe itself.
  // data/ (the SQLite DB) and logs/ hold runtime state — once deploy/ has its
  // own, a rebuild must never clobber it with the project's copy. .env is
  // carried over too (a fresh .exe would otherwise self-extract a blank
  // template on first run).
  fs.mkdirSync(DEPLOY, { recursive: true });
  fs.copyFileSync(EXE_FILE, path.join(DEPLOY, EXE_NAME));
  copyIfExists(path.join(ROOT, '.env'), path.join(DEPLOY, '.env'));

  const deployDataDir = path.join(DEPLOY, 'data');
  const deployDbFile = path.join(deployDataDir, 'app.db');
  if (fs.existsSync(deployDbFile)) {
    console.log('deploy/data/app.db already exists — leaving it untouched (it holds the live users/groups/activity). Delete deploy/data yourself first if you really want to reseed it from the project\'s data/.');
  } else {
    console.log('Seeding deploy/data from the project\'s data/ (existing users, imported AD groups/users, activity history)...');
    copyIfExists(path.join(ROOT, 'data'), deployDataDir);
  }

  console.log('\nDone. Deployable folder: ' + DEPLOY);
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
