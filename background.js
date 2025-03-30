// Base URL for the Hypocampus API
const API_BASE_URL = "https://lmg-prod.cortexio.se/v1/file/";

// Download queue state
let downloadPaused = false;
let downloadQueue = [];
let currentIndex = 0;
let downloadStartTime = 0;
let totalItems = 0;
let pauseStartTime = 0;
let totalPausedTime = 0;

// Function to get the authentication token from cookies
async function getAuthToken() {
	try {
		// Try to get the token from storage
		const data = await chrome.storage.local.get("privilegeToken");
		if (data.privilegeToken) {
			return data.privilegeToken;
		}

		// If no token in storage, try to get it from the content script
		// by sending a message to the active tab
		const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
		if (tabs[0]) {
			try {
				const response = await chrome.tabs.sendMessage(tabs[0].id, {
					action: "getPrivilegeToken",
				});

				if (response?.token) {
					// Save the token to storage for future use
					await chrome.storage.local.set({ privilegeToken: response.token });
					return response.token;
				}
			} catch (err) {
				console.error("Error communicating with content script:", err);
			}
		}

		// No token found - user might need to log in first
		return null;
	} catch (error) {
		console.error("Error getting authentication token:", error);
		return null;
	}
}

// Function to download a single PDF
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

// Reset download state
function resetDownloadState() {
	downloadPaused = false;
	downloadQueue = [];
	currentIndex = 0;
	downloadStartTime = 0;
	totalItems = 0;
	pauseStartTime = 0;
	totalPausedTime = 0;
}

// Listen for messages from the content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.action === "downloadSingle") {
		downloadPDF(message.pk, message.name).then((success) => {
			if (success) {
				chrome.tabs.sendMessage(sender.tab.id, {
					action: "downloadComplete",
					type: "single",
					name: message.name,
				});
			}
		});
		return true; // Keep the message channel open for the async response
	}

	if (message.action === "downloadAll") {
		// Reset download state
		downloadPaused = false;
		downloadQueue = [...message.items];
		currentIndex = 0;
		downloadStartTime = message.startTime || Date.now();
		totalItems = message.totalItems || downloadQueue.length;
		totalPausedTime = 0;

		// Start the download process
		processDownloadQueue(sender.tab.id);
		return true; // Keep the message channel open for the async response
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

		// Continue processing the queue
		processDownloadQueue(sender.tab.id);
		return true;
	}

	if (message.action === "cancelDownload") {
		// Reset download state
		resetDownloadState();
		return true;
	}

	if (message.action === "savePrivilegeToken") {
		chrome.storage.local.set({ privilegeToken: message.token });
		sendResponse({ success: true });
		return true;
	}
});

// Calculate remaining time based on progress
function calculateRemainingTime() {
	if (currentIndex === 0) return totalItems * 1500; // Initial estimate
	const remainingItems = totalItems - currentIndex;

	return Math.max(0, Math.round(remainingItems * 500));
}

// Process the download queue
async function processDownloadQueue(tabId) {
	if (downloadPaused || currentIndex >= downloadQueue.length) {
		// If paused or finished, stop processing
		if (currentIndex >= downloadQueue.length) {
			chrome.tabs.sendMessage(tabId, {
				action: "downloadComplete",
				type: "all",
				count: currentIndex,
			});
		}
		return;
	}

	// Send progress update with time remaining calculation
	const remainingTimeMs = calculateRemainingTime();
	chrome.tabs.sendMessage(tabId, {
		action: "downloadProgress",
		current: currentIndex,
		total: totalItems,
		remainingTimeMs: remainingTimeMs,
	});

	const item = downloadQueue[currentIndex];
	const success = await downloadPDF(item.pk, item.name);

	// Move to next item
	currentIndex++;

	// Send progress update after each download
	chrome.tabs.sendMessage(tabId, {
		action: "downloadProgress",
		current: currentIndex,
		total: totalItems,
		remainingTimeMs: calculateRemainingTime(),
	});

	// Add a small delay between downloads to avoid overwhelming the server
	if (currentIndex < downloadQueue.length && !downloadPaused) {
		await new Promise((resolve) => setTimeout(resolve, 250));
		processDownloadQueue(tabId);
	} else if (currentIndex >= downloadQueue.length) {
		// All downloads completed
		chrome.tabs.sendMessage(tabId, {
			action: "downloadComplete",
			type: "all",
			count: currentIndex,
		});
	}
}

// When extension is installed/updated
chrome.runtime.onInstalled.addListener(() => {
	console.log("Hypocampus PDF Downloader extension installed");
});
