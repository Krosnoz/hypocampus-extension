// Log that the content script is loading
console.log("Hypocampus PDF Downloader: Content script is loading...");

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
	const ficheItems = document.querySelectorAll('a[href*="/app/lmg/read/"]');

	if (ficheItems.length === 0) {
		return; // No fiches found on the page
	}

	// Inject "Download All" button if not already present
	if (!document.querySelector(".hypo-download-all-btn")) {
		const allFiches = Array.from(ficheItems)
			.map((item) => {
				const pkMatch = item.href.match(/\/read\/([^?]+)/);
				const pk = pkMatch ? pkMatch[1] : null;

				const titleElement = item.querySelector(".listTitle");
				if (!titleElement) return;
				const name = titleElement.textContent.trim();

				return { pk, name };
			})
			.filter((item) => !!item && item.pk);

		const downloadAllButton = document.createElement("div");
		downloadAllButton.className = "hypo-download-all-btn";
		downloadAllButton.textContent = "Tout Télécharger";
		downloadAllButton.addEventListener("click", () => {
			// Disable the button after clicking
			downloadAllButton.classList.add("hypo-download-all-btn-disabled");
			downloadAllButton.style.pointerEvents = "none";
			downloadAllButton.style.opacity = "0.6";

			// Calculate total estimated time
			const totalItems = allFiches.length;
			const avgDownloadTime = 500; // 250ms timeout + ~250ms per download (estimate)
			const totalTimeMs = totalItems * avgDownloadTime;

			chrome.runtime.sendMessage({
				action: "downloadAll",
				items: allFiches,
				startTime: Date.now(),
				totalItems: totalItems,
			});

			// Show progress indicator and control buttons
			const progressContainer = document.createElement("div");
			progressContainer.className = "hypo-download-controls";

			// Progress text with time remaining
			const progressElement = document.createElement("div");
			progressElement.className = "hypo-download-progress";
			progressElement.innerHTML = `Téléchargement en cours: 0/${totalItems}<span class="hypo-time-remaining">Temps restant: ${formatTime(totalTimeMs)}</span>`;

			// Pause button
			const pauseButton = document.createElement("button");
			pauseButton.className = "hypo-control-btn hypo-pause-btn";
			pauseButton.textContent = "Pause";
			pauseButton.addEventListener("click", () => {
				chrome.runtime.sendMessage({ action: "pauseDownload" });
			});

			// Resume button
			const resumeButton = document.createElement("button");
			resumeButton.className = "hypo-control-btn hypo-resume-btn";
			resumeButton.textContent = "Reprendre";
			resumeButton.style.display = "none"; // Hide initially
			resumeButton.addEventListener("click", () => {
				chrome.runtime.sendMessage({ action: "resumeDownload" });
			});

			// Cancel button
			const cancelButton = document.createElement("button");
			cancelButton.className = "hypo-control-btn hypo-cancel-btn";
			cancelButton.textContent = "Annuler";
			cancelButton.addEventListener("click", () => {
				chrome.runtime.sendMessage({ action: "cancelDownload" });

				// Remove the progress container
				progressContainer.remove();

				// Re-enable the download all button
				downloadAllButton.classList.remove("hypo-download-all-btn-disabled");
				downloadAllButton.style.pointerEvents = "auto";
				downloadAllButton.style.opacity = "1";
			});

			// Add all elements to the container
			progressContainer.appendChild(progressElement);
			progressContainer.appendChild(pauseButton);
			progressContainer.appendChild(resumeButton);
			progressContainer.appendChild(cancelButton);

			// Insert right after the Download All button
			downloadAllButton.parentNode.insertBefore(
				progressContainer,
				downloadAllButton.nextSibling,
			);
		});

		// Insert the button before the first fiche item
		const firstFiche = ficheItems[0];
		const containerElement = firstFiche.closest("div") || document.body;
		containerElement.insertBefore(
			downloadAllButton,
			containerElement.firstChild,
		);
	}

	// Add individual download buttons to each fiche
	for (const item of ficheItems) {
		// Skip if we've already added a download button to this item
		if (item.querySelector(".hypo-download-btn")) {
			continue;
		}

		// Extract the pk (document ID) from the URL
		const pkMatch = item.href.match(/\/read\/([^?]+)/);
		if (!pkMatch) continue;
		const pk = pkMatch[1];

		// Get the document name
		const titleElement = item.querySelector(".listTitle");
		const name = titleElement ? titleElement.textContent.trim() : "Document";

		// Create download button
		const downloadButton = document.createElement("button");
		downloadButton.className = "hypo-download-btn";
		downloadButton.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
      <span>Télécharger</span>
    `;

		// Add click event to handle download
		downloadButton.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();

			chrome.runtime.sendMessage({
				action: "downloadSingle",
				pk: pk,
				name: name,
			});
		});

		// Find where to insert the button (next to "Nouvel onglet" button)
		const targetRow = item.querySelector('a[target="_blank"]');
		if (targetRow?.parentNode) {
			targetRow.parentNode.appendChild(downloadButton);
		}
	}
}

// Helper function to format time in minutes and seconds
function formatTime(milliseconds) {
	const totalSeconds = Math.ceil(milliseconds / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}m ${seconds}s`;
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.action === "getPrivilegeToken") {
		const token = getPrivilegeToken();
		sendResponse({ token: token });
		return true; // Keep the message channel open for the async response
	}

	if (message.action === "downloadComplete") {
		const progressElements = document.querySelectorAll(
			".hypo-download-progress",
		);
		for (const element of progressElements) {
			element.innerHTML = "<strong>Téléchargement terminé!</strong>";
			setTimeout(() => {
				// Remove the entire controls container and re-enable download button
				const controlsContainer = element.closest(".hypo-download-controls");
				if (controlsContainer) {
					controlsContainer.remove();

					// Re-enable the download all button
					const downloadAllButton = document.querySelector(
						".hypo-download-all-btn",
					);
					if (downloadAllButton) {
						downloadAllButton.classList.remove(
							"hypo-download-all-btn-disabled",
						);
						downloadAllButton.style.pointerEvents = "auto";
						downloadAllButton.style.opacity = "1";
					}
				}
			}, 3000);
		}
	} else if (message.action === "downloadProgress") {
		const progressElements = document.querySelectorAll(
			".hypo-download-progress",
		);
		const { current, total, remainingTimeMs } = message;

		for (const element of progressElements) {
			element.innerHTML = `Téléchargement en cours: ${current}/${total}<span class="hypo-time-remaining">Temps restant: ${formatTime(remainingTimeMs)}</span>`;
		}
	} else if (message.action === "pauseDownloadUI") {
		const pauseButtons = document.querySelectorAll(".hypo-pause-btn");
		const resumeButtons = document.querySelectorAll(".hypo-resume-btn");

		for (const btn of pauseButtons) {
			btn.style.display = "none";
		}
		for (const btn of resumeButtons) {
			btn.style.display = "inline-block";
		}

		const progressElements = document.querySelectorAll(
			".hypo-download-progress",
		);
		for (const el of progressElements) {
			// Keep the HTML structure with time remaining
			const timeSpan = el.querySelector(".hypo-time-remaining");
			if (timeSpan) {
				el.innerHTML = `<strong>Téléchargement en pause</strong>${timeSpan.outerHTML}`;
			} else {
				el.innerHTML = "<strong>Téléchargement en pause</strong>";
			}
		}
	} else if (message.action === "resumeDownloadUI") {
		const pauseButtons = document.querySelectorAll(".hypo-pause-btn");
		const resumeButtons = document.querySelectorAll(".hypo-resume-btn");

		for (const btn of pauseButtons) {
			btn.style.display = "inline-block";
		}
		for (const btn of resumeButtons) {
			btn.style.display = "none";
		}

		const progressElements = document.querySelectorAll(
			".hypo-download-progress",
		);
		for (const el of progressElements) {
			// Don't modify time remaining when resuming
			const timeSpan = el.querySelector(".hypo-time-remaining");
			if (timeSpan) {
				el.innerHTML = `Téléchargement repris...${timeSpan.outerHTML}`;
			} else {
				el.innerHTML = "Téléchargement repris...";
			}
		}
	} else if (message.action === "error") {
		alert(`Erreur: ${message.message}`);
	}

	return false;
});
