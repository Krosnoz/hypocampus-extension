// Base URL for the Hypocampus API
const API_BASE_URL = "https://lmg-prod.cortexio.se/v1/file/";

// Variables for tracking download state
let downloadPaused = false;
let pauseStartTime = 0;
let totalPausedTime = 0;
let downloadQueue = [];
let currentIndex = 0;
let downloadStartTime = 0;
let totalItems = 0;

// Variables for zip download
let currentZip = null;
let zipDownloadInProgress = false;

// Function to get auth token
async function getAuthToken() {
	try {
		const result = await chrome.storage.local.get("privilegeToken");
		return result.privilegeToken;
	} catch (error) {
		console.error("Error getting auth token:", error);
		return null;
	}
}

// Function to download a single PDF for individual download
async function downloadPDF(pk, name) {
	try {
		const token = await getAuthToken();

		if (!token) {
			// Notify user to log in
			chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
				if (tabs[0]) {
					chrome.tabs.sendMessage(tabs[0].id, {
						action: "error",
						message:
							"Authentication failed. Please log in to Hypocampus first.",
					});
				}
			});
			return;
		}

		// Fetch the file
		const url = `${API_BASE_URL}${pk}`;
		const response = await fetch(url, {
			headers: {
				Authorization: `Bearer ${token}`,
			},
		});

		if (!response.ok) {
			throw new Error(`HTTP error: ${response.status}`);
		}

		const data = await response.json();

		// Get the PDF data in base64
		const pdfBase64 = data.file;

		if (!pdfBase64) {
			throw new Error("No PDF data found in response");
		}

		// Convert to blob
		const byteCharacters = atob(pdfBase64);
		const byteNumbers = new Array(byteCharacters.length);
		for (let i = 0; i < byteCharacters.length; i++) {
			byteNumbers[i] = byteCharacters.charCodeAt(i);
		}
		const byteArray = new Uint8Array(byteNumbers);
		const blob = new Blob([byteArray], { type: "application/pdf" });

		// Sanitize the filename
		const sanitizedName = name.replace(/[,\/\\:*?"<>|]/g, "-");

		// Use chrome.downloads API to download the file with the Blob directly
		const reader = new FileReader();
		reader.onloadend = () => {
			const base64data = reader.result.split(",")[1];
			chrome.downloads.download({
				url: `data:application/pdf;base64,${base64data}`,
				filename: `${sanitizedName}.pdf`,
				saveAs: false,
			});
		};
		reader.readAsDataURL(blob);

		return true;
	} catch (error) {
		console.error("Error downloading PDF:", error);
		return false;
	}
}

// Function to get PDF data for zip creation
async function getPDFData(pk) {
	try {
		const token = await getAuthToken();

		if (!token) {
			throw new Error("Authentication failed. Please log in to Hypocampus first.");
		}

		// Fetch the file
		const url = `${API_BASE_URL}${pk}`;
		const response = await fetch(url, {
			headers: {
				Authorization: `Bearer ${token}`,
			},
		});

		if (!response.ok) {
			throw new Error(`HTTP error: ${response.status}`);
		}

		const data = await response.json();

		// Get the PDF data in base64
		const pdfBase64 = data.file;

		if (!pdfBase64) {
			throw new Error("No PDF data found in response");
		}

		return pdfBase64;
	} catch (error) {
		console.error("Error getting PDF data:", error);
		throw error;
	}
}

// Reset download state
function resetDownloadState() {
	downloadPaused = false;
	pauseStartTime = 0;
	totalPausedTime = 0;
	downloadQueue = [];
	currentIndex = 0;
	downloadStartTime = 0;
	totalItems = 0;
	currentZip = null;
	zipDownloadInProgress = false;
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.action === "downloadPDF") {
		downloadPDF(message.pk, message.name);
		return true;
	}

	if (message.action === "getPDFData") {
		getPDFData(message.pk)
			.then((pdfBase64) => {
				sendResponse({ success: true, data: pdfBase64 });
			})
			.catch((error) => {
				sendResponse({ success: false, error: error.message });
			});
		return true;
	}

	if (message.action === "downloadAll") {
		// Reset download state
		resetDownloadState();
		downloadQueue = [...message.items];
		currentIndex = 0;
		downloadStartTime = message.startTime || Date.now();
		totalItems = message.totalItems || downloadQueue.length;
		totalPausedTime = 0;
		zipDownloadInProgress = true;

		// Start the zip creation process by sending back to content script
		chrome.tabs.sendMessage(sender.tab.id, {
			action: "startZipCreation",
			items: downloadQueue,
		});
		return true;
	}

	if (message.action === "pauseDownload") {
		downloadPaused = true;
		pauseStartTime = Date.now();

		// Update UI to show paused state
		chrome.tabs.sendMessage(sender.tab.id, {
			action: "pauseDownloadUI",
		});
		return true;
	}

	if (message.action === "resumeDownload") {
		// Calculate pause duration
		if (pauseStartTime > 0) {
			totalPausedTime += Date.now() - pauseStartTime;
			pauseStartTime = 0;
		}

		downloadPaused = false;

		// Update UI to show resumed state
		chrome.tabs.sendMessage(sender.tab.id, {
			action: "resumeDownloadUI",
		});

		// Continue processing
		chrome.tabs.sendMessage(sender.tab.id, {
			action: "resumeZipCreation",
		});
		return true;
	}

	if (message.action === "cancelDownload") {
		// Reset download state
		resetDownloadState();
		chrome.tabs.sendMessage(sender.tab.id, {
			action: "cancelZipCreation",
		});
		return true;
	}

	if (message.action === "savePrivilegeToken") {
		chrome.storage.local.set({ privilegeToken: message.token });
		sendResponse({ success: true });
		return true;
	}

	if (message.action === "getDownloadState") {
		sendResponse({
			downloadPaused,
			currentIndex,
			totalItems,
			downloadStartTime,
			totalPausedTime,
			zipDownloadInProgress,
		});
		return true;
	}
});

// Function to calculate remaining time
function calculateRemainingTime() {
	if (currentIndex === 0) return 0;

	const currentTime = Date.now();
	const elapsedTime = currentTime - downloadStartTime - totalPausedTime;
	const avgTimePerItem = elapsedTime / currentIndex;
	const remainingItems = totalItems - currentIndex;

	return avgTimePerItem * remainingItems;
}

// When extension is installed/updated
chrome.runtime.onInstalled.addListener(() => {
	console.log("Hypocampus PDF Downloader extension installed");
});
