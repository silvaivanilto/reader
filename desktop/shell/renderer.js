let state = {
	activeTabID: null,
	themePreference: 'system',
	tabs: [],
};

const tabsNode = document.getElementById('tabs');
const dropOverlayNode = document.getElementById('drop-overlay');
const openFileButton = document.getElementById('open-file-btn');
const newTabButton = document.getElementById('new-tab-btn');
const themeSelect = document.getElementById('theme-select');
const defaultAppsButton = document.getElementById('default-apps-btn');

function hasFilePayload(event) {
	let types = Array.from(event.dataTransfer?.types || []);
	return types.includes('Files');
}

function getDroppedFilePaths(event) {
	if (!event.dataTransfer?.files?.length) {
		return [];
	}
	return Array.from(event.dataTransfer.files)
		.map(file => file.path)
		.filter(Boolean);
}

function renderTabs() {
	tabsNode.replaceChildren();

	for (let tab of state.tabs) {
		let tabNode = document.createElement('button');
		tabNode.type = 'button';
		tabNode.className = 'tab' + (tab.id === state.activeTabID ? ' active' : '');
		tabNode.title = tab.filePath || tab.title;

		let titleNode = document.createElement('span');
		titleNode.className = 'tab-title';
		titleNode.textContent = tab.title;

		let closeNode = document.createElement('button');
		closeNode.type = 'button';
		closeNode.className = 'tab-close';
		closeNode.textContent = '×';
		closeNode.title = 'Fechar aba';

		tabNode.addEventListener('click', () => {
			window.desktopShell.activateTab(tab.id);
		});

		closeNode.addEventListener('click', (event) => {
			event.stopPropagation();
			window.desktopShell.closeTab(tab.id);
		});

		tabNode.append(titleNode, closeNode);
		tabsNode.append(tabNode);
	}
}

function applyState(newState) {
	state = {
		...state,
		...newState,
	};
	themeSelect.value = state.themePreference;
	renderTabs();
}

function installDragAndDrop() {
	let dragDepth = 0;

	window.addEventListener('dragenter', (event) => {
		if (!hasFilePayload(event)) {
			return;
		}
		dragDepth += 1;
		dropOverlayNode.classList.add('visible');
		event.preventDefault();
	});

	window.addEventListener('dragover', (event) => {
		if (!hasFilePayload(event)) {
			return;
		}
		event.preventDefault();
	});

	window.addEventListener('dragleave', (event) => {
		if (!hasFilePayload(event)) {
			return;
		}
		dragDepth = Math.max(0, dragDepth - 1);
		if (dragDepth === 0) {
			dropOverlayNode.classList.remove('visible');
		}
		event.preventDefault();
	});

	window.addEventListener('drop', (event) => {
		if (!hasFilePayload(event)) {
			return;
		}
		event.preventDefault();
		dragDepth = 0;
		dropOverlayNode.classList.remove('visible');
		let paths = getDroppedFilePaths(event);
		if (paths.length) {
			window.desktopShell.openFiles(paths, { preferTabID: state.activeTabID });
		}
	});
}

function installUIActions() {
	openFileButton.addEventListener('click', () => {
		window.desktopShell.openFileDialog();
	});

	newTabButton.addEventListener('click', () => {
		window.desktopShell.newTab();
	});

	themeSelect.addEventListener('change', () => {
		window.desktopShell.setThemePreference(themeSelect.value);
	});

	defaultAppsButton.addEventListener('click', () => {
		window.desktopShell.openDefaultAppsSettings();
	});
}

async function initialize() {
	installUIActions();
	installDragAndDrop();

	let initialState = await window.desktopShell.getState();
	applyState(initialState);
	window.desktopShell.onState(applyState);
}

initialize();
