import express from "express";
import puppeteer from "puppeteer";

const PORT = 3000;
const app = express();

app.get("/scrape", async (req, res) => {
	const targetUrl = "https://www.bloomberg.com/live/us"; // Using the URL from your logs
	const findTimeout = 10000; // Max time (ms) to wait for the m3u8 link before giving up

	async function findMinimalM3u8Link(url) {
		if (!url) {
			console.error("Error: URL is required.");
			return null;
		}

		let browser = null;
		let m3u8Link = null;
		let page = null;
		let linkFoundResolver = null; // Function to resolve the promise externally

		// Promise that resolves when the link is found
		const linkFoundPromise = new Promise((resolve) => {
			linkFoundResolver = resolve;
		});

		console.log(`Attempting to scrape: ${url}`);

		try {
			console.log("Launching browser...");
			// Note: Puppeteer 1.0.0 might have slightly different launch options if needed
			browser = await puppeteer.launch({
				headless: true,
				args: [
					"--no-sandbox",
					"--disable-setuid-sandbox",
					"--disable-blink-features=AutomationControlled",
				],
			});

			page = await browser.newPage();
			await page.setUserAgent(
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
			);

			console.log("Setting up network request interception...");
			await page.setRequestInterception(true);

			page.on("request", async (request) => {
				// Using `let` because we might reassign `page` to null during cleanup
				const currentPage = page;
				const requestUrl = request.url();

				if (requestUrl.endsWith(".m3u8") && !m3u8Link) {
					console.log(`---> Found potential M3U8 request: ${requestUrl}`);
					m3u8Link = requestUrl; // Store the link

					// Signal that the link has been found
					if (linkFoundResolver) {
						linkFoundResolver(); // Resolve the promise
					}

					// Stop processing any further requests immediately
					try {
						if (currentPage && !currentPage.isClosed()) {
							await currentPage.setRequestInterception(false); // Turn off interception
						}
					} catch (e) {
						console.warn(
							"Warning: Could not disable request interception during cleanup.",
							e.message,
						);
					}
					// Abort this current request as we don't need it anymore
					try {
						if (!request.isInterceptResolutionHandled()) {
							await request.abort();
						}
					} catch (e) {
						/* Ignore abort errors */
					}
				} else if (!m3u8Link) {
					// Continue other requests only if link not found yet
					try {
						if (!request.isInterceptResolutionHandled()) {
							await request.continue();
						}
					} catch (e) {
						/* Ignore continue errors */
					}
				} else {
					// If link *is* found, abort subsequent requests
					try {
						if (!request.isInterceptResolutionHandled()) {
							await request.abort();
						}
					} catch (e) {
						/* Ignore abort errors */
					}
				}
			});

			console.log(
				`Navigating to ${url}... (will stop once .m3u8 is found or after timeout)`,
			);
			// Navigate - don't wait excessively, let the request listener handle finding the link
			// Using 'domcontentloaded' might be slightly faster if the request occurs early
			page
				.goto(url, { waitUntil: "domcontentloaded", timeout: findTimeout })
				.catch((e) => {
					// Navigation errors (like timeouts) might be okay if the M3U8 was found before the error
					if (!m3u8Link) {
						console.warn(
							`Navigation potentially failed before M3U8 link found: ${e.message}`,
						);
					} else {
						console.log(
							"Navigation ended (or timed out), but M3U8 link was already found.",
						);
					}
				});

			// Wait for EITHER the M3U8 link to be found OR the timeout
			console.log(
				`Waiting up to ${findTimeout / 1000} seconds for the M3U8 link...`,
			);
			await Promise.race([
				linkFoundPromise, // Resolves when linkFoundResolver() is called
				new Promise((resolve) => setTimeout(resolve, findTimeout)), // Timeout
			]);

			// If we are here, either the link was found OR timeout occurred.
			// The browser closing is handled in the finally block.
		} catch (error) {
			// Catch errors during setup/navigation if any occur *before* the race completes
			// Avoid reporting if we actually found the link but had a cleanup issue
			if (!m3u8Link) {
				console.error(`An error occurred during setup or navigation: ${error}`);
			}
		} finally {
			// This block executes regardless of whether the try block succeeded or failed
			if (browser) {
				console.log("Closing browser (finally block)...");
				await browser.close(); // Ensure browser is closed
				browser = null; // Help garbage collection
				page = null;
			}
		}

		// Final result report
		if (m3u8Link) {
			console.log(`\n✅ Successfully extracted M3U8 Link:\n${m3u8Link}\n`);
		} else {
			console.log(
				`\n❌ M3U8 link not detected within ${findTimeout / 1000} seconds.`,
			);
		}
		return m3u8Link;
	}

	// --- Run the scraper ---
	const m3u8Link = await findMinimalM3u8Link(targetUrl); // Await the result of the function
	res.send({
    link:m3u8Link
  }); // Use the result in the response
});

app.listen(PORT, () => {
	console.log(`Scraping server running at http://localhost:${PORT}`);
});
