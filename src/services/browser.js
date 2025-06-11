const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { BROWSER_OPTIONS } = require('../config/constants');

puppeteer.use(StealthPlugin());

let browserInstance = null;

async function getBrowser() {
    if (!browserInstance || !browserInstance.isConnected()) {
        try {
            console.log('Initializing new browser instance...');
            browserInstance = await puppeteer.launch(BROWSER_OPTIONS);
            browserInstance.on('disconnected', () => {
                console.log('Browser disconnected.');
                browserInstance = null;
            });
            console.log('Browser initialized successfully.');
        } catch (error) {
            console.error('Could not create a browser instance => : ', error);
            throw error; // Re-throw the error to be handled by the caller
        }
    }
    return browserInstance;
}

async function closeBrowser() {
    if (browserInstance) {
        await browserInstance.close();
        browserInstance = null;
        console.log('Browser closed.');
    }
}

module.exports = { getBrowser, closeBrowser };
