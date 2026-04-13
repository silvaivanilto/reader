const fs = require('fs');
const path = require('path');
const {
	app,
	BrowserView,
	BrowserWindow,
	dialog,
	ipcMain,
	Menu,
	nativeTheme,
	shell,
} = require('electron');
const { DEFAULT_SETTINGS, loadSettings, saveSettings } = require('./settings.cjs');

const TAB_BAR_HEIGHT = 58;
const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.epub', '.html', '.htm']);
const SUPPORTED_THEME_PREFERENCES = new Set(['system', 'light', 'dark']);

let mainWindow = null;
let tabs = [];
let activeTabID = null;
let nextTabID = 1;
let settings = { ...DEFAULT_SETTINGS };

function getReaderHTMLPath() {
	return path.join(app.getAppPath(), 'build', 'web', 'reader.html');
}

function getShellHTMLPath() {
	return path.join(__dirname, 'shell', 'index.html');
}

function getShellPreloadPath() {
	return path.join(__dirname, 'shell', 'preload-shell.cjs');
}

function getReaderPreloadPath() {
	return path.join(__dirname, 'shell', 'preload-reader.cjs');
}

function normalizeThemePreference(value) {
	return SUPPORTED_THEME_PREFERENCES.has(value) ? value : DEFAULT_SETTINGS.themePreference;
}

function isSupportedFile(filePath) {
	let extension = path.extname(filePath).toLowerCase();
	return SUPPORTED_EXTENSIONS.has(extension);
}

function extractSupportedFiles(argv = []) {
	let files = [];
	for (let arg of argv) {
		if (!arg || arg.startsWith('-')) {
			continue;
		}
		let normalized = arg.replace(/^"+|"+$/g, '');
		try {
			if (
				fs.existsSync(normalized)
				&& fs.statSync(normalized).isFile()
				&& isSupportedFile(normalized)
			) {
				files.push(path.resolve(normalized));
			}
		}
		catch {
			// Ignore malformed path arguments
		}
	}
	return Array.from(new Set(files));
}

function getTabByID(tabID) {
	return tabs.find(tab => tab.id === tabID) || null;
}

function getTabByWebContents(webContents) {
	return tabs.find(tab => tab.view.webContents.id === webContents.id) || null;
}

function getActiveTab() {
	return getTabByID(activeTabID);
}

function getStateSnapshot() {
	return {
		activeTabID,
		themePreference: settings.themePreference,
		tabs: tabs.map(tab => ({
			id: tab.id,
			title: tab.title,
			filePath: tab.filePath,
		})),
	};
}

function broadcastState() {
	if (!mainWindow || mainWindow.isDestroyed()) {
		return;
	}
	mainWindow.webContents.send('tabs:state', getStateSnapshot());
}

function layoutActiveView() {
	if (!mainWindow || mainWindow.isDestroyed()) {
		return;
	}

	let activeTab = getActiveTab();
	mainWindow.setBrowserView(activeTab ? activeTab.view : null);
	if (!activeTab) {
		return;
	}

	let [width, height] = mainWindow.getContentSize();
	activeTab.view.setBounds({
		x: 0,
		y: TAB_BAR_HEIGHT,
		width,
		height: Math.max(0, height - TAB_BAR_HEIGHT),
	});
	activeTab.view.setAutoResize({ width: true, height: true });
}

function loadReaderPage(view) {
	let readerHTMLPath = getReaderHTMLPath();
	if (fs.existsSync(readerHTMLPath)) {
		return view.webContents.loadFile(readerHTMLPath);
	}

	let content = `
		<!doctype html>
		<html>
			<head>
				<meta charset="utf-8" />
				<title>Zotero Reader</title>
				<style>
					body { font-family: Segoe UI, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; display: grid; place-items: center; height: 100vh; }
					main { max-width: 680px; padding: 24px; text-align: center; line-height: 1.5; }
					code { background: #111827; border-radius: 6px; padding: 2px 6px; }
				</style>
			</head>
			<body>
				<main>
					<h1>Build web não encontrado</h1>
					<p>Execute <code>npm run build:web</code> antes de iniciar o app desktop.</p>
				</main>
			</body>
		</html>
	`;
	return view.webContents.loadURL('data:text/html;charset=UTF-8,' + encodeURIComponent(content));
}

function createReaderView() {
	let view = new BrowserView({
		webPreferences: {
			preload: getReaderPreloadPath(),
			contextIsolation: false,
			nodeIntegration: true,
			sandbox: false,
			spellcheck: false,
		},
	});

	view.webContents.setWindowOpenHandler(({ url }) => {
		if (url) {
			shell.openExternal(url).catch(() => {});
		}
		return { action: 'deny' };
	});

	view.webContents.on('will-navigate', (event, url) => {
		// Prevent top-level navigation away from the reader shell.
		if (url.startsWith('file://')) {
			return;
		}
		event.preventDefault();
		shell.openExternal(url).catch(() => {});
	});

	return view;
}

function refreshTab(tab) {
	tab.loaded = false;
	loadReaderPage(tab.view).catch((error) => {
		console.error('Falha ao carregar a página do reader.', error);
	});
}

function createTab({ filePath = null, activate = true } = {}) {
	let tab = {
		id: nextTabID++,
		title: filePath ? path.basename(filePath) : 'Nova aba',
		filePath: filePath ? path.resolve(filePath) : null,
		view: createReaderView(),
		loaded: false,
	};

	tab.view.webContents.on('did-finish-load', () => {
		tab.loaded = true;
		if (tab.filePath) {
			tab.view.webContents.send('reader:open-file', tab.filePath);
		}
		else {
			tab.view.webContents.send('reader:show-empty-state');
		}
	});

	tabs.push(tab);
	refreshTab(tab);

	if (activate || activeTabID === null) {
		setActiveTab(tab.id);
	}
	else {
		broadcastState();
	}

	return tab;
}

function setActiveTab(tabID) {
	let tab = getTabByID(tabID);
	if (!tab) {
		return false;
	}
	activeTabID = tabID;
	layoutActiveView();
	broadcastState();
	return true;
}

function closeTab(tabID) {
	let index = tabs.findIndex(tab => tab.id === tabID);
	if (index === -1) {
		return false;
	}

	let [tab] = tabs.splice(index, 1);
	tab.view.webContents.destroy();

	if (!tabs.length) {
		activeTabID = null;
		createTab({ activate: true });
		return true;
	}

	if (activeTabID === tabID) {
		let nextIndex = Math.min(index, tabs.length - 1);
		activeTabID = tabs[nextIndex].id;
	}

	layoutActiveView();
	broadcastState();
	return true;
}

function openFileInTab(tab, filePath) {
	let resolved = path.resolve(filePath);
	if (!isSupportedFile(resolved)) {
		return false;
	}

	tab.filePath = resolved;
	tab.title = path.basename(resolved);
	refreshTab(tab);
	broadcastState();
	return true;
}

function openFiles(filePaths, { preferTabID = activeTabID } = {}) {
	let normalized = filePaths
		.map(filePath => path.resolve(filePath))
		.filter(filePath => isSupportedFile(filePath) && fs.existsSync(filePath));
	normalized = Array.from(new Set(normalized));

	if (!normalized.length) {
		return getStateSnapshot();
	}

	let preferredTab = getTabByID(preferTabID);
	let lastOpenedTab = null;

	for (let [index, filePath] of normalized.entries()) {
		if (index === 0 && preferredTab && !preferredTab.filePath) {
			openFileInTab(preferredTab, filePath);
			lastOpenedTab = preferredTab;
		}
		else {
			lastOpenedTab = createTab({ filePath, activate: false });
		}
	}

	if (lastOpenedTab) {
		setActiveTab(lastOpenedTab.id);
	}

	return getStateSnapshot();
}

async function openFileDialog() {
	if (!mainWindow || mainWindow.isDestroyed()) {
		return getStateSnapshot();
	}

	let result = await dialog.showOpenDialog(mainWindow, {
		title: 'Abrir arquivo',
		properties: ['openFile', 'multiSelections'],
		filters: [
			{ name: 'Documentos suportados', extensions: ['pdf', 'epub', 'html', 'htm'] },
			{ name: 'PDF', extensions: ['pdf'] },
			{ name: 'EPUB', extensions: ['epub'] },
			{ name: 'HTML', extensions: ['html', 'htm'] },
		],
	});

	if (result.canceled || !result.filePaths.length) {
		return getStateSnapshot();
	}

	return openFiles(result.filePaths, { preferTabID: activeTabID });
}

async function openDefaultAppsSettings() {
	if (process.platform === 'win32') {
		await shell.openExternal('ms-settings:defaultapps');
		return;
	}
	await shell.openExternal('https://support.microsoft.com/windows/change-default-apps');
}

function setThemePreference(themePreference, { persist = true } = {}) {
	let normalized = normalizeThemePreference(themePreference);
	settings.themePreference = normalized;
	nativeTheme.themeSource = normalized;
	if (persist) {
		saveSettings(settings);
	}
	refreshMenu();
	broadcastState();
}

function buildMenuTemplate() {
	return [
		{
			label: 'Arquivo',
			submenu: [
				{
					label: 'Nova aba',
					accelerator: 'Ctrl+T',
					click: () => createTab({ activate: true }),
				},
				{
					label: 'Abrir arquivo...',
					accelerator: 'Ctrl+O',
					click: () => openFileDialog(),
				},
				{
					label: 'Fechar aba',
					accelerator: 'Ctrl+W',
					click: () => {
						if (activeTabID !== null) {
							closeTab(activeTabID);
						}
					},
				},
				{ type: 'separator' },
				{
					label: 'Definir como padrão (PDF/EPUB/HTML)...',
					click: () => openDefaultAppsSettings(),
				},
				{ type: 'separator' },
				{
					label: 'Sair',
					role: 'quit',
				},
			],
		},
		{
			label: 'Exibir',
			submenu: [
				{
					label: 'Tema automático',
					type: 'radio',
					checked: settings.themePreference === 'system',
					click: () => setThemePreference('system'),
				},
				{
					label: 'Tema claro',
					type: 'radio',
					checked: settings.themePreference === 'light',
					click: () => setThemePreference('light'),
				},
				{
					label: 'Tema escuro',
					type: 'radio',
					checked: settings.themePreference === 'dark',
					click: () => setThemePreference('dark'),
				},
				{ type: 'separator' },
				{ role: 'toggleDevTools', label: 'Ferramentas de desenvolvedor' },
			],
		},
	];
}

function refreshMenu() {
	let menu = Menu.buildFromTemplate(buildMenuTemplate());
	Menu.setApplicationMenu(menu);
}

function registerIPC() {
	ipcMain.handle('tabs:get-state', () => getStateSnapshot());

	ipcMain.handle('tabs:new', () => {
		createTab({ activate: true });
		return getStateSnapshot();
	});

	ipcMain.handle('tabs:activate', (_event, tabID) => {
		setActiveTab(tabID);
		return getStateSnapshot();
	});

	ipcMain.handle('tabs:close', (_event, tabID) => {
		closeTab(tabID);
		return getStateSnapshot();
	});

	ipcMain.handle('tabs:open-dialog', () => openFileDialog());

	ipcMain.handle('tabs:open-files', (_event, payload = {}) => {
		let paths = Array.isArray(payload.paths) ? payload.paths : [];
		let preferTabID = Number.isInteger(payload.preferTabID) ? payload.preferTabID : activeTabID;
		return openFiles(paths, { preferTabID });
	});

	ipcMain.handle('theme:set', (_event, themePreference) => {
		setThemePreference(themePreference);
		return settings.themePreference;
	});

	ipcMain.handle('theme:get', () => settings.themePreference);

	ipcMain.handle('app:open-default-apps', async () => {
		await openDefaultAppsSettings();
		return true;
	});

	ipcMain.handle('reader:get-tab-id', (event) => {
		let tab = getTabByWebContents(event.sender);
		return tab ? tab.id : null;
	});

	ipcMain.on('reader:request-open-files', (event, payload = {}) => {
		let tab = getTabByWebContents(event.sender);
		let paths = Array.isArray(payload.paths) ? payload.paths : [];
		openFiles(paths, { preferTabID: tab ? tab.id : activeTabID });
	});

	ipcMain.on('reader:open-external', (_event, url) => {
		if (typeof url === 'string' && url.trim()) {
			shell.openExternal(url).catch(() => {});
		}
	});
}

function createMainWindow(onReady) {
	mainWindow = new BrowserWindow({
		width: 1460,
		height: 920,
		minWidth: 1040,
		minHeight: 700,
		backgroundColor: '#0b1220',
		show: false,
		webPreferences: {
			preload: getShellPreloadPath(),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
		},
	});

	mainWindow.on('resize', layoutActiveView);
	mainWindow.on('maximize', layoutActiveView);
	mainWindow.on('unmaximize', layoutActiveView);

	mainWindow.on('closed', () => {
		mainWindow = null;
		for (let tab of tabs) {
			if (!tab.view.webContents.isDestroyed()) {
				tab.view.webContents.destroy();
			}
		}
		tabs = [];
		activeTabID = null;
	});

	mainWindow.webContents.once('did-finish-load', () => {
		onReady?.();
	});

	mainWindow.once('ready-to-show', () => {
		mainWindow.show();
	});

	mainWindow.loadFile(getShellHTMLPath());
}

function bootstrap() {
	let startupFiles = extractSupportedFiles(process.argv);
	settings = loadSettings();
	setThemePreference(settings.themePreference, { persist: false });
	registerIPC();
	refreshMenu();

	createMainWindow(() => {
		if (startupFiles.length) {
			openFiles(startupFiles, { preferTabID: null });
		}
		else {
			createTab({ activate: true });
		}
		broadcastState();
		layoutActiveView();
	});
}

let gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
	app.quit();
}
else {
	app.on('second-instance', (_event, argv) => {
		let files = extractSupportedFiles(argv);
		if (mainWindow && !mainWindow.isDestroyed()) {
			if (mainWindow.isMinimized()) {
				mainWindow.restore();
			}
			mainWindow.focus();
		}
		if (files.length) {
			openFiles(files, { preferTabID: activeTabID });
		}
	});

	app.whenReady().then(bootstrap);
}

app.on('window-all-closed', () => {
	app.quit();
});
