const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULT_SETTINGS = Object.freeze({
	themePreference: 'system',
});

function getSettingsPath() {
	return path.join(app.getPath('userData'), 'settings.json');
}

function normalizeThemePreference(value) {
	return ['system', 'light', 'dark'].includes(value) ? value : DEFAULT_SETTINGS.themePreference;
}

function loadSettings() {
	try {
		let filePath = getSettingsPath();
		if (!fs.existsSync(filePath)) {
			return { ...DEFAULT_SETTINGS };
		}
		let raw = fs.readFileSync(filePath, 'utf8');
		let parsed = JSON.parse(raw);
		return {
			themePreference: normalizeThemePreference(parsed.themePreference),
		};
	}
	catch (error) {
		console.error('Falha ao carregar configurações. Usando padrão.', error);
		return { ...DEFAULT_SETTINGS };
	}
}

function saveSettings(settings) {
	let filePath = getSettingsPath();
	let normalized = {
		themePreference: normalizeThemePreference(settings.themePreference),
	};
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2), 'utf8');
}

module.exports = {
	DEFAULT_SETTINGS,
	loadSettings,
	saveSettings,
};
