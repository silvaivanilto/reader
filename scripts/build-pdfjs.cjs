const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PDFJS_DIR = path.join(ROOT, 'pdfjs', 'pdf.js');
const BUILD_BASE = path.join(ROOT, 'build');
const PDFJS_BUILD = path.join(PDFJS_DIR, 'build', 'generic');
const PDFJS_LEGACY_BUILD = path.join(PDFJS_DIR, 'build', 'generic-legacy');
const PDFJS_MINIFIED_LEGACY_BUILD = path.join(PDFJS_DIR, 'build', 'minified-legacy');
const LOCAL_VIEWER_CSS = path.join(ROOT, 'pdfjs', 'viewer.css');

const config = (process.argv[2] || process.env.PDFJS_CONFIG || '').trim();
const validConfigs = new Set(['zotero', 'web', 'dev', 'all']);

if (!validConfigs.has(config)) {
	console.error('Error: missing/invalid config. Use one of: zotero, web, dev, all');
	process.exit(1);
}

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function run(command, args, cwd = ROOT) {
	if (process.platform === 'win32') {
		let quote = (value) => /[\s"]/u.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
		let fullCommand = [command, ...args].map(quote).join(' ');
		execFileSync('cmd.exe', ['/d', '/s', '/c', fullCommand], {
			cwd,
			stdio: 'inherit',
		});
		return;
	}

	execFileSync(command, args, {
		cwd,
		stdio: 'inherit',
	});
}

function ensureDir(dirPath) {
	fs.mkdirSync(dirPath, { recursive: true });
}

function resetDir(dirPath) {
	fs.rmSync(dirPath, { recursive: true, force: true });
	ensureDir(dirPath);
}

function copyEntry(src, dest) {
	let stat = fs.statSync(src);
	if (stat.isDirectory()) {
		fs.cpSync(src, dest, { recursive: true, force: true });
	}
	else {
		ensureDir(path.dirname(dest));
		fs.copyFileSync(src, dest);
	}
}

function setupBuildDir(buildName) {
	let buildDir = path.join(BUILD_BASE, buildName, 'pdf');
	resetDir(buildDir);
	ensureDir(path.join(buildDir, 'build'));
	ensureDir(path.join(buildDir, 'web', 'images'));
	return buildDir;
}

function copyCommonPdfjsOutput(buildDir, sourceBase, options = {}) {
	copyEntry(path.join(sourceBase, 'LICENSE'), path.join(buildDir, 'LICENSE'));

	if (options.copyMinifiedWorker) {
		copyEntry(
			path.join(PDFJS_MINIFIED_LEGACY_BUILD, 'build', 'pdf.min.mjs'),
			path.join(buildDir, 'build', 'pdf.mjs')
		);
		copyEntry(
			path.join(PDFJS_MINIFIED_LEGACY_BUILD, 'build', 'pdf.worker.min.mjs'),
			path.join(buildDir, 'build', 'pdf.worker.mjs')
		);
	}
	else {
		copyEntry(path.join(sourceBase, 'build', 'pdf.mjs'), path.join(buildDir, 'build', 'pdf.mjs'));
		copyEntry(path.join(sourceBase, 'build', 'pdf.worker.mjs'), path.join(buildDir, 'build', 'pdf.worker.mjs'));
	}

	copyEntry(path.join(sourceBase, 'web', 'cmaps'), path.join(buildDir, 'web', 'cmaps'));
	copyEntry(path.join(sourceBase, 'web', 'standard_fonts'), path.join(buildDir, 'web', 'standard_fonts'));
	copyEntry(path.join(sourceBase, 'web', 'iccs'), path.join(buildDir, 'web', 'iccs'));
	copyEntry(path.join(sourceBase, 'web', 'wasm'), path.join(buildDir, 'web', 'wasm'));
	copyEntry(path.join(sourceBase, 'web', 'viewer.html'), path.join(buildDir, 'web', 'viewer.html'));
	copyEntry(path.join(sourceBase, 'web', 'images', 'loading-icon.gif'), path.join(buildDir, 'web', 'images', 'loading-icon.gif'));
	copyEntry(LOCAL_VIEWER_CSS, path.join(buildDir, 'web', 'viewer.css'));
}

function buildDev() {
	let buildDir = setupBuildDir('dev');
	copyCommonPdfjsOutput(buildDir, PDFJS_BUILD);
	copyEntry(path.join(PDFJS_BUILD, 'web', 'viewer.mjs'), path.join(buildDir, 'web', 'viewer.mjs'));
}

function buildWeb() {
	let buildDir = setupBuildDir('web');
	copyCommonPdfjsOutput(buildDir, PDFJS_LEGACY_BUILD, { copyMinifiedWorker: true });
	run(
		npxCmd,
		[
			'terser',
			path.join(PDFJS_LEGACY_BUILD, 'web', 'viewer.mjs'),
			'-o',
			path.join(buildDir, 'web', 'viewer.mjs'),
		],
		ROOT
	);
}

function buildZotero() {
	let buildDir = setupBuildDir('zotero');
	copyCommonPdfjsOutput(buildDir, PDFJS_BUILD);
	copyEntry(path.join(PDFJS_BUILD, 'web', 'viewer.mjs'), path.join(buildDir, 'web', 'viewer.mjs'));
}

run(npmCmd, ['ci', '--include=dev'], PDFJS_DIR);

if (config !== 'web') {
	run(npxCmd, ['gulp', 'generic'], PDFJS_DIR);
}
if (config === 'web' || config === 'all') {
	run(npxCmd, ['gulp', 'generic-legacy'], PDFJS_DIR);
	run(npxCmd, ['gulp', 'minified-legacy'], PDFJS_DIR);
}

if (config === 'dev' || config === 'all') {
	buildDev();
}
if (config === 'web' || config === 'all') {
	buildWeb();
}
if (config === 'zotero' || config === 'all') {
	buildZotero();
}
