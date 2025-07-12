// Log that the content script is loading
console.log("Hypocampus PDF Downloader: Content script is loading...");

// Variables for zip download management
let currentZip = null;
let zipDownloadQueue = [];
let zipCurrentIndex = 0;
let zipDownloadPaused = false;
let zipDownloadStartTime = 0;
let zipTotalItems = 0;
let zipProcessingInProgress = false;

// Function to extract the privilege token from local storage
function getPrivilegeToken() {
	try {
		// Check if we can find the token in localStorage
		if (window.localStorage) {
			const token = localStorage.getItem("privilegeToken");
			if (token) {
				return token;
			}
		}

		return null;
	} catch (error) {
		return null;
	}
}

// Send the token to the background script when the content script loads
function sendTokenToBackground() {
	const token = getPrivilegeToken();
	if (token) {
		chrome.runtime.sendMessage({
			action: "savePrivilegeToken",
			token: token,
		});
	}
}

// Call this function when the script loads
sendTokenToBackground();

// Wait for the page to be fully loaded
document.addEventListener("DOMContentLoaded", () => {
	// Give a bit of time for dynamic content to load
	setTimeout(injectButtons, 1000);
});

// Also try when DOM changes, in case the page loads dynamically
const observer = new MutationObserver(() => {
	// Check if our target elements exist
	const ficheItems = document.querySelectorAll('a[href*="/app/lmg/read/"]');
	if (ficheItems.length > 0) {
		injectButtons();
	}
});

// Start observing the document with the configured parameters
observer.observe(document.body, { childList: true, subtree: true });

// Function to inject both individual download buttons and the "Download All" button
function injectButtons() {
	// Find all the link elements that match the pattern
	const ficheItems = document.querySelectorAll('a[href*="/app/lmg/read/"]');

	// Inject "Download All" button if not already present
	if (!document.querySelector(".hypo-download-all-btn")) {
		// Extract all the pks and names from the links
		const items = [];
		ficheItems.forEach((link) => {
			const href = link.getAttribute("href");
			const pk = href.split("/read/")[1];
			const name = link.textContent.trim();
			items.push({ pk, name });
		});

		if (items.length > 0) {
			// Create "Download All" button
			const downloadAllButton = document.createElement("div");
			downloadAllButton.className = "hypo-download-all-btn";
			downloadAllButton.textContent = "Tout Télécharger (ZIP)";
			downloadAllButton.addEventListener("click", () => {
				// Disable the button to prevent multiple clicks
				downloadAllButton.classList.add("hypo-download-all-btn-disabled");
				downloadAllButton.style.pointerEvents = "none";
				downloadAllButton.style.opacity = "0.6";

				// Send message to background script to start download
				chrome.runtime.sendMessage({
					action: "downloadAll",
					items: items,
					totalItems: items.length,
					startTime: Date.now(),
				});
			});

			// Insert right after the Download All button
			downloadAllButton.parentNode.insertBefore(
				createDownloadControls(),
				downloadAllButton.nextSibling,
			);

			// Insert the button in the page
			// Insert after the first parent element that contains the fiches
			const firstFicheParent = ficheItems[0].closest(".file-item, .list-item, .item");
			if (firstFicheParent && firstFicheParent.parentNode) {
				firstFicheParent.parentNode.insertBefore(
					downloadAllButton,
					firstFicheParent,
				);
			}
		}
	}

	// Process each link
	ficheItems.forEach((link) => {
		// Check if this link already has a download button
		if (link.querySelector(".hypo-download-btn")) {
			return; // Skip if already processed
		}

		// Extract the pk from the href
		const href = link.getAttribute("href");
		const pk = href.split("/read/")[1];

		// Get the name from the link text
		const name = link.textContent.trim();

		// Create download button
		const downloadBtn = document.createElement("button");
		downloadBtn.className = "hypo-download-btn";
		downloadBtn.textContent = "📥";
		downloadBtn.title = "Télécharger ce PDF";

		// Add click event listener
		downloadBtn.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();

			// Change button text to show loading
			downloadBtn.textContent = "⏳";
			downloadBtn.disabled = true;

			// Send message to background script
			chrome.runtime.sendMessage({
				action: "downloadPDF",
				pk: pk,
				name: name,
			});

			// Reset button after a short delay
			setTimeout(() => {
				downloadBtn.textContent = "📥";
				downloadBtn.disabled = false;
			}, 2000);
		});

		// Add the button to the link
		link.appendChild(downloadBtn);
	});
}

// Function to create download controls (pause/resume/cancel)
function createDownloadControls() {
	const controlsDiv = document.createElement("div");
	controlsDiv.className = "hypo-download-controls";
	controlsDiv.style.display = "none";

	// Progress display
	const progressDiv = document.createElement("div");
	progressDiv.className = "hypo-download-progress";
	progressDiv.textContent = "Préparation du téléchargement...";

	// Pause button
	const pauseBtn = document.createElement("button");
	pauseBtn.className = "hypo-pause-btn";
	pauseBtn.textContent = "⏸ Pause";
	pauseBtn.addEventListener("click", () => {
		chrome.runtime.sendMessage({ action: "pauseDownload" });
	});

	// Resume button
	const resumeBtn = document.createElement("button");
	resumeBtn.className = "hypo-resume-btn";
	resumeBtn.textContent = "▶ Reprendre";
	resumeBtn.style.display = "none";
	resumeBtn.addEventListener("click", () => {
		chrome.runtime.sendMessage({ action: "resumeDownload" });
	});

	// Cancel button
	const cancelBtn = document.createElement("button");
	cancelBtn.className = "hypo-cancel-btn";
	cancelBtn.textContent = "❌ Annuler";
	cancelBtn.addEventListener("click", () => {
		chrome.runtime.sendMessage({ action: "cancelDownload" });
	});

	// Add all elements to controls div
	controlsDiv.appendChild(progressDiv);
	controlsDiv.appendChild(pauseBtn);
	controlsDiv.appendChild(resumeBtn);
	controlsDiv.appendChild(cancelBtn);

	return controlsDiv;
}

// Function to format time in milliseconds to a readable format
function formatTime(milliseconds) {
	const seconds = Math.floor(milliseconds / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);

	if (hours > 0) {
		return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
	} else if (minutes > 0) {
		return `${minutes}m ${seconds % 60}s`;
	} else {
		return `${seconds}s`;
	}
}

// Function to start zip creation
async function startZipCreation(items) {
	console.log("Starting zip creation with", items.length, "items");
	
	// Initialize zip variables
	currentZip = new JSZip();
	zipDownloadQueue = [...items];
	zipCurrentIndex = 0;
	zipDownloadPaused = false;
	zipDownloadStartTime = Date.now();
	zipTotalItems = items.length;
	zipProcessingInProgress = true;

	// Show controls
	const controlsDiv = document.querySelector(".hypo-download-controls");
	if (controlsDiv) {
		controlsDiv.style.display = "block";
	}

	// Start processing
	await processZipQueue();
}

// Function to process the zip queue
async function processZipQueue() {
	if (zipDownloadPaused || zipCurrentIndex >= zipDownloadQueue.length) {
		// If paused or finished, stop processing
		if (zipCurrentIndex >= zipDownloadQueue.length) {
			await finalizeZipDownload();
		}
		return;
	}

	// Update progress display
	const progressElements = document.querySelectorAll(".hypo-download-progress");
	const remainingTimeMs = calculateZipRemainingTime();
	
	for (const element of progressElements) {
		element.innerHTML = `Création du ZIP: ${zipCurrentIndex}/${zipTotalItems}<span class="hypo-time-remaining">Temps restant: ${formatTime(remainingTimeMs)}</span>`;
	}

	const item = zipDownloadQueue[zipCurrentIndex];
	
	try {
		// Get PDF data from background script
		const response = await new Promise((resolve) => {
			chrome.runtime.sendMessage({
				action: "getPDFData",
				pk: item.pk,
			}, resolve);
		});

		if (response.success) {
			// Convert base64 to binary data
			const byteCharacters = atob(response.data);
			const byteNumbers = new Array(byteCharacters.length);
			for (let i = 0; i < byteCharacters.length; i++) {
				byteNumbers[i] = byteCharacters.charCodeAt(i);
			}
			const byteArray = new Uint8Array(byteNumbers);

			// Sanitize the filename
			const sanitizedName = item.name.replace(/[,\/\\:*?"<>|]/g, "-");
			
			// Add PDF to zip
			currentZip.file(`${sanitizedName}.pdf`, byteArray);
			
			console.log(`Added ${sanitizedName}.pdf to zip`);
		} else {
			console.error("Failed to get PDF data:", response.error);
		}
		
		// Move to next item
		zipCurrentIndex++;

		// Update progress after each file added
		const newRemainingTimeMs = calculateZipRemainingTime();
		for (const element of progressElements) {
			element.innerHTML = `Création du ZIP: ${zipCurrentIndex}/${zipTotalItems}<span class="hypo-time-remaining">Temps restant: ${formatTime(newRemainingTimeMs)}</span>`;
		}

		// Add a small delay between downloads to avoid overwhelming the server
		if (zipCurrentIndex < zipDownloadQueue.length && !zipDownloadPaused) {
			await new Promise((resolve) => setTimeout(resolve, 500));
			await processZipQueue();
		} else if (zipCurrentIndex >= zipDownloadQueue.length) {
			// All PDFs added to zip, finalize download
			await finalizeZipDownload();
		}
	} catch (error) {
		console.error("Error adding PDF to zip:", error);
		// Skip this file and continue with the next one
		zipCurrentIndex++;
		
		if (zipCurrentIndex < zipDownloadQueue.length && !zipDownloadPaused) {
			await new Promise((resolve) => setTimeout(resolve, 500));
			await processZipQueue();
		} else if (zipCurrentIndex >= zipDownloadQueue.length) {
			await finalizeZipDownload();
		}
	}
}

// Function to calculate remaining time for zip creation
function calculateZipRemainingTime() {
	if (zipCurrentIndex === 0) return 0;

	const currentTime = Date.now();
	const elapsedTime = currentTime - zipDownloadStartTime;
	const avgTimePerItem = elapsedTime / zipCurrentIndex;
	const remainingItems = zipTotalItems - zipCurrentIndex;

	return avgTimePerItem * remainingItems;
}

// Function to finalize zip download
async function finalizeZipDownload() {
	if (!currentZip) return;

	try {
		// Update progress to show zip generation
		const progressElements = document.querySelectorAll(".hypo-download-progress");
		for (const element of progressElements) {
			element.innerHTML = "Génération du fichier ZIP...";
		}

		// Generate the zip file
		const zipBlob = await currentZip.generateAsync({
			type: "blob",
			compression: "DEFLATE",
			compressionOptions: {
				level: 6
			}
		});

		// Create download link
		const url = URL.createObjectURL(zipBlob);
		const a = document.createElement("a");
		a.href = url;
		
		// Generate filename with timestamp
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
		a.download = `Hypocampus_PDFs_${timestamp}.zip`;
		
		// Trigger download
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		
		// Clean up
		URL.revokeObjectURL(url);

		// Show completion message
		for (const element of progressElements) {
			element.innerHTML = `<strong>Téléchargement terminé!</strong> ${zipCurrentIndex} fichiers dans le ZIP`;
		}

		// Reset state after a delay
		setTimeout(() => {
			resetZipState();
		}, 3000);

		console.log("Zip download completed successfully");
	} catch (error) {
		console.error("Error generating zip:", error);
		alert("Erreur lors de la création du fichier ZIP");
		resetZipState();
	}
}

// Function to reset zip state
function resetZipState() {
	currentZip = null;
	zipDownloadQueue = [];
	zipCurrentIndex = 0;
	zipDownloadPaused = false;
	zipDownloadStartTime = 0;
	zipTotalItems = 0;
	zipProcessingInProgress = false;

	// Hide controls
	const controlsDiv = document.querySelector(".hypo-download-controls");
	if (controlsDiv) {
		controlsDiv.style.display = "none";
	}

	// Re-enable the download all button
	const downloadAllButton = document.querySelector(".hypo-download-all-btn");
	if (downloadAllButton) {
		downloadAllButton.classList.remove("hypo-download-all-btn-disabled");
		downloadAllButton.style.pointerEvents = "auto";
		downloadAllButton.style.opacity = "1";
	}
}

// Function to pause zip creation
function pauseZipCreation() {
	zipDownloadPaused = true;
	
	const pauseButtons = document.querySelectorAll(".hypo-pause-btn");
	const resumeButtons = document.querySelectorAll(".hypo-resume-btn");

	for (const btn of pauseButtons) {
		btn.style.display = "none";
	}
	for (const btn of resumeButtons) {
		btn.style.display = "inline-block";
	}

	const progressElements = document.querySelectorAll(".hypo-download-progress");
	for (const el of progressElements) {
		const timeSpan = el.querySelector(".hypo-time-remaining");
		if (timeSpan) {
			el.innerHTML = `<strong>Création du ZIP en pause</strong>${timeSpan.outerHTML}`;
		} else {
			el.innerHTML = "<strong>Création du ZIP en pause</strong>";
		}
	}
}

// Function to resume zip creation
function resumeZipCreation() {
	zipDownloadPaused = false;
	
	const pauseButtons = document.querySelectorAll(".hypo-pause-btn");
	const resumeButtons = document.querySelectorAll(".hypo-resume-btn");

	for (const btn of pauseButtons) {
		btn.style.display = "inline-block";
	}
	for (const btn of resumeButtons) {
		btn.style.display = "none";
	}

	const progressElements = document.querySelectorAll(".hypo-download-progress");
	for (const el of progressElements) {
		const timeSpan = el.querySelector(".hypo-time-remaining");
		if (timeSpan) {
			el.innerHTML = `Création du ZIP reprise...${timeSpan.outerHTML}`;
		} else {
			el.innerHTML = "Création du ZIP reprise...";
		}
	}

	// Continue processing
	processZipQueue();
}

// Function to cancel zip creation
function cancelZipCreation() {
	resetZipState();
	
	const progressElements = document.querySelectorAll(".hypo-download-progress");
	for (const el of progressElements) {
		el.innerHTML = "<strong>Téléchargement annulé</strong>";
	}
	
	setTimeout(() => {
		resetZipState();
	}, 2000);
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.action === "getPrivilegeToken") {
		const token = getPrivilegeToken();
		sendResponse({ token: token });
		return true; // Keep the message channel open for the async response
	}

	if (message.action === "downloadComplete") {
		// Handle the old individual download completion
		if (message.type === "single") {
			console.log(`Download completed for: ${message.name}`);
		} else if (message.type === "all") {
			// Re-enable the download all button
			const downloadAllButton = document.querySelector(".hypo-download-all-btn");
			if (downloadAllButton) {
				downloadAllButton.classList.remove("hypo-download-all-btn-disabled");
				downloadAllButton.style.pointerEvents = "auto";
				downloadAllButton.style.opacity = "1";
			}

			// Hide the download controls
			const controlsDiv = document.querySelector(".hypo-download-controls");
			if (controlsDiv) {
				controlsDiv.style.display = "none";
			}

			// Update progress display
			const progressElements = document.querySelectorAll(".hypo-download-progress");
			for (const el of progressElements) {
				el.innerHTML = `<strong>Téléchargement terminé!</strong> ${message.count} fichiers téléchargés`;
			}

			// Clear the progress message after a few seconds
			setTimeout(() => {
				for (const el of progressElements) {
					el.innerHTML = "";
				}
			}, 3000);
		}
	} else if (message.action === "startZipCreation") {
		startZipCreation(message.items);
	} else if (message.action === "pauseDownloadUI") {
		pauseZipCreation();
	} else if (message.action === "resumeDownloadUI") {
		resumeZipCreation();
	} else if (message.action === "resumeZipCreation") {
		resumeZipCreation();
	} else if (message.action === "cancelZipCreation") {
		cancelZipCreation();
	} else if (message.action === "downloadProgress") {
		const progressElements = document.querySelectorAll(".hypo-download-progress");
		const { current, total, remainingTimeMs } = message;

		for (const element of progressElements) {
			element.innerHTML = `Téléchargement en cours: ${current}/${total}<span class="hypo-time-remaining">Temps restant: ${formatTime(remainingTimeMs)}</span>`;
		}
	} else if (message.action === "error") {
		alert(`Erreur: ${message.message}`);
	}

	return false;
});
