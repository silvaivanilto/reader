const fs = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');
const { ipcRenderer } = require('electron');

const FILE_TYPE_BY_EXTENSION = {
	'.pdf': 'pdf',
	'.epub': 'epub',
	'.html': 'snapshot',
	'.htm': 'snapshot',
};

let emptyStateNode = null;
let dropOverlayNode = null;

function detectReaderType(filePath) {
	let extension = path.extname(filePath).toLowerCase();
	return FILE_TYPE_BY_EXTENSION[extension] || null;
}

function injectDesktopStyles() {
	if (document.getElementById('desktop-reader-style')) {
		return;
	}
	let style = document.createElement('style');
	style.id = 'desktop-reader-style';
	style.textContent = `
		#desktop-empty-state {
			position: fixed;
			inset: 0;
			display: grid;
			place-items: center;
			background: radial-gradient(circle at top, rgba(30, 64, 175, 0.2), transparent 50%), #0b1220;
			color: #dbeafe;
			z-index: 9999;
			font-family: "Segoe UI", sans-serif;
			text-align: center;
			padding: 24px;
		}
		#desktop-empty-state .card {
			max-width: 700px;
			background: rgba(15, 23, 42, 0.82);
			border: 1px solid rgba(148, 163, 184, 0.28);
			border-radius: 16px;
			padding: 28px 32px;
			backdrop-filter: blur(10px);
			box-shadow: 0 24px 60px rgba(2, 6, 23, 0.55);
		}
		#desktop-empty-state h1 {
			font-size: 30px;
			margin: 0 0 12px;
			letter-spacing: 0.4px;
		}
		#desktop-empty-state p {
			margin: 0;
			font-size: 16px;
			line-height: 1.55;
			color: #cbd5e1;
		}
		#desktop-drop-overlay {
			position: fixed;
			inset: 20px;
			border-radius: 18px;
			border: 2px dashed rgba(148, 163, 184, 0.85);
			background: rgba(8, 47, 73, 0.42);
			backdrop-filter: blur(6px);
			display: none;
			align-items: center;
			justify-content: center;
			z-index: 10000;
			font-family: "Segoe UI", sans-serif;
			font-size: 20px;
			font-weight: 600;
			color: #e0f2fe;
			pointer-events: none;
		}
		#desktop-drop-overlay.visible {
			display: flex;
		}
	`;
	document.head.append(style);
}

function ensureDropOverlay() {
	if (dropOverlayNode) {
		return dropOverlayNode;
	}
	dropOverlayNode = document.createElement('div');
	dropOverlayNode.id = 'desktop-drop-overlay';
	dropOverlayNode.textContent = 'Solte para abrir no leitor';
	document.body.append(dropOverlayNode);
	return dropOverlayNode;
}

function showDropOverlay() {
	ensureDropOverlay().classList.add('visible');
}

function hideDropOverlay() {
	if (dropOverlayNode) {
		dropOverlayNode.classList.remove('visible');
	}
}

function showEmptyState(message = null) {
	if (!emptyStateNode) {
		emptyStateNode = document.createElement('div');
		emptyStateNode.id = 'desktop-empty-state';
		emptyStateNode.innerHTML = `
			<div class="card">
				<h1>Zotero Reader Desktop</h1>
				<p id="desktop-empty-state-message"></p>
			</div>
		`;
		document.body.append(emptyStateNode);
	}
	let description = message
		|| 'Abra um arquivo (Ctrl+O) ou arraste um PDF, EPUB ou HTML para esta janela.';
	let messageNode = emptyStateNode.querySelector('#desktop-empty-state-message');
	messageNode.textContent = description;
}

function hideEmptyState() {
	if (emptyStateNode) {
		emptyStateNode.remove();
		emptyStateNode = null;
	}
}

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

async function waitForCreateReader(timeoutMS = 20000) {
	let start = Date.now();
	while (typeof window.createReader !== 'function') {
		if (Date.now() - start > timeoutMS) {
			throw new Error('window.createReader não ficou disponível a tempo.');
		}
		await new Promise(resolve => setTimeout(resolve, 50));
	}
}

async function buildReaderData(filePath, type) {
	let fileURL = pathToFileURL(filePath).toString();
	if (type === 'snapshot') {
		return {
			url: fileURL,
			importedFromURL: fileURL,
		};
	}
	let buf = new Uint8Array(await fs.readFile(filePath));
	return {
		buf,
		url: fileURL,
	};
}

function makeReaderCallbacks() {
	let noOp = () => {};
	return {
		onAddToNote: noOp,
		onSaveAnnotations: async () => {},
		onDeleteAnnotations: noOp,
		onChangeViewState: noOp,
		onOpenTagsPopup: noOp,
		onClosePopup: noOp,
		onToggleSidebar: noOp,
		onChangeSidebarWidth: noOp,
		onChangeSidebarView: noOp,
		onSetDataTransferAnnotations: noOp,
		onRotatePages: noOp,
		onDeletePages: noOp,
		onToggleContextPane: noOp,
		onTextSelectionAnnotationModeChange: noOp,
		onSaveCustomThemes: noOp,
		onSetReadAloudVoice: noOp,
		onSetReadAloudStatus: noOp,
		onLogIn: noOp,
	};
}

async function openFileInReader(filePath) {
	try {
		let absolutePath = path.resolve(filePath);
		let type = detectReaderType(absolutePath);
		if (!type) {
			showEmptyState('Formato não suportado. Use PDF, EPUB, HTML ou HTM.');
			return;
		}

		hideEmptyState();
		await waitForCreateReader();

		let data = await buildReaderData(absolutePath, type);
		let callbacks = makeReaderCallbacks();
		let reader;
		reader = window.createReader({
			type,
			data,
			readOnly: true,
			annotations: [],
			sidebarWidth: 280,
			sidebarView: type === 'pdf' ? 'thumbnails' : 'outline',
			showAnnotations: false,
			loggedIn: false,
			colorScheme: null,
			onOpenContextMenu(params) {
				return reader.openContextMenu(params);
			},
			onOpenLink(url) {
				if (/^(https?|mailto|tel):/i.test(url)) {
					ipcRenderer.send('reader:open-external', url);
				}
				else {
					window.open(url, '_self');
				}
			},
			onConfirm(_title, text) {
				return window.confirm(text);
			},
			enableReadAloud: true,
			readAloudRemoteInterface: null,
			...callbacks,
		});
		window._desktopReader = reader;
		await reader.initializedPromise;
		document.title = `${path.basename(absolutePath)} - Zotero Reader`;
	}
	catch (error) {
		console.error('Erro ao abrir arquivo no reader.', error);
		showEmptyState('Não foi possível abrir este arquivo. Verifique se ele está acessível.');
	}
}

function installDragAndDrop() {
	let dragDepth = 0;

	window.addEventListener('dragenter', (event) => {
		if (!hasFilePayload(event)) {
			return;
		}
		dragDepth += 1;
		showDropOverlay();
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
			hideDropOverlay();
		}
		event.preventDefault();
	});

	window.addEventListener('drop', (event) => {
		if (!hasFilePayload(event)) {
			return;
		}
		event.preventDefault();
		dragDepth = 0;
		hideDropOverlay();
		let paths = getDroppedFilePaths(event);
		if (paths.length) {
			ipcRenderer.send('reader:request-open-files', { paths });
		}
	});
}

ipcRenderer.on('reader:show-empty-state', () => {
	showEmptyState();
});

ipcRenderer.on('reader:open-file', (_event, filePath) => {
	openFileInReader(filePath);
});

window.addEventListener('DOMContentLoaded', () => {
	injectDesktopStyles();
	showEmptyState();
	installDragAndDrop();
});
