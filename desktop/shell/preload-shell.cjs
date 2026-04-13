const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopShell', {
	getState: () => ipcRenderer.invoke('tabs:get-state'),
	newTab: () => ipcRenderer.invoke('tabs:new'),
	activateTab: (tabID) => ipcRenderer.invoke('tabs:activate', tabID),
	closeTab: (tabID) => ipcRenderer.invoke('tabs:close', tabID),
	openFileDialog: () => ipcRenderer.invoke('tabs:open-dialog'),
	openFiles: (paths, options = {}) => ipcRenderer.invoke('tabs:open-files', {
		paths,
		preferTabID: options.preferTabID,
	}),
	getThemePreference: () => ipcRenderer.invoke('theme:get'),
	setThemePreference: (themePreference) => ipcRenderer.invoke('theme:set', themePreference),
	openDefaultAppsSettings: () => ipcRenderer.invoke('app:open-default-apps'),
	onState: (handler) => {
		let listener = (_event, state) => handler(state);
		ipcRenderer.on('tabs:state', listener);
		return () => ipcRenderer.removeListener('tabs:state', listener);
	},
});
