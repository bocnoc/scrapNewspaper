const cheerio = require('cheerio');
const { getBrowser } = require('./browser');
const { CATEGORY_MAP } = require('../config/constants');

async function setupPage(url) {
    const browser = await getBrowser();
    const page = await browser.newPage();

    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
            req.abort();
        } else {
            req.continue();
        }
    });

    await page.setExtraHTTPHeaders({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
    });

    return { page, browser };
}

function cleanHtml(html) {
    const $ = cheerio.load(html);
    $('script, style, noscript, iframe, link, meta, header, footer, .ad, .advertisement, .ads, .popup, .social-share').remove();
    $('*').each(function() {
        if ($(this).html().trim() === '') {
            $(this).remove();
        }
    });
    return $.html();
}

async function scrapeArticle(url) {
    let page;
    let browser;
    
    // Đảm bảo URL là hợp lệ
    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
        throw new Error(`Invalid URL: ${url}`);
    }
    
    console.log(`[Scraper] Starting to scrape article: ${url}`);
    
    try {
        const setup = await setupPage(url);
        page = setup.page;
        browser = setup.browser;

        console.log(`[Scraper] Browser initialized, navigating to: ${url}`);
        
        const response = await page.goto(url, { 
            waitUntil: 'networkidle2',
            timeout: 45000 // Tăng timeout lên 45 giây
        });

        if (!response) {
            throw new Error('No response from the server');
        }
        
        if (!response.ok()) {
            throw new Error(`HTTP ${response.status()} - ${response.statusText()}`);
        }
        
        console.log(`[Scraper] Successfully loaded page: ${response.url()}`);
        
        // Kiểm tra xem có bị chặn bởi Cloudflare không
        const isBlocked = await page.evaluate(() => {
            return document.title.includes('Just a moment') || 
                   document.body.textContent.includes('Checking your browser');
        });
        
        if (isBlocked) {
            console.warn('[Scraper] Warning: Page might be blocked by Cloudflare');
            // Thử đợi thêm một chút thời gian
            await page.waitForTimeout(5000);
        }

        const mainContentSelectors = ['article', '.main-content', '#content', 'main'];
        let contentHTML = '';
        for (const selector of mainContentSelectors) {
            contentHTML = await page.evaluate((sel) => {
                const element = document.querySelector(sel);
                return element ? element.innerHTML : null;
            }, selector);
            if (contentHTML) break;
        }

        if (!contentHTML) {
            throw new Error('Could not find main content of the article.');
        }

        const title = await page.title();
        const description = await page.$eval('meta[name="description"]', element => element.content).catch(() => '');

        return {
            title,
            description,
            content: cleanHtml(contentHTML),
            url
        };
    } finally {
        if (page) {
            await page.close();
        }
    }
}

async function scrapeCategory(category) {
    const url = CATEGORY_MAP[category];
    if (!url) {
        throw new Error(`Category '${category}' not found in CATEGORY_MAP`);
    }
    
    // Đảm bảo URL là hợp lệ
    if (!url.startsWith('http')) {
        throw new Error(`Invalid URL for category '${category}': ${url}`);
    }

    console.log(`[Scraper] Starting to scrape category: ${category} from ${url}`);
    
    let page;
    let browser;
    
    try {
        const setup = await setupPage(url);
        page = setup.page;
        browser = setup.browser;

        console.log(`[Scraper] Browser initialized, navigating to: ${url}`);
        
        const response = await page.goto(url, { 
            waitUntil: 'networkidle2',
            timeout: 45000 // Tăng timeout lên 45 giây
        });

        if (!response) {
            throw new Error('No response from the server');
        }
        
        if (!response.ok()) {
            throw new Error(`HTTP ${response.status()} - ${response.statusText()}`);
        }
        
        console.log(`[Scraper] Successfully loaded category page: ${response.url()}`);
        
        // Kiểm tra xem có bị chặn bởi Cloudflare không
        const isBlocked = await page.evaluate(() => {
            return document.title.includes('Just a moment') || 
                   document.body.textContent.includes('Checking your browser');
        });
        
        if (isBlocked) {
            console.warn('[Scraper] Warning: Category page might be blocked by Cloudflare');
            // Thử đợi thêm một chút thời gian
            await page.waitForTimeout(5000);
        }

        // Wait for articles to load
        await page.waitForSelector('article, .item-news, .news-item, .story', { timeout: 10000 })
            .catch(() => console.log('No article elements found, continuing anyway...'));

        const articles = await page.evaluate((currentCategory, categoryUrl) => {
            const articleElements = Array.from(document.querySelectorAll('article, .item-news, .news-item, .story'));
            console.log(`Found ${articleElements.length} article elements`);
            
            return articleElements.map(article => {
                try {
                    const titleEl = article.querySelector('h2, h3, .title, .title-news, a[title]') || article;
                    const linkEl = article.querySelector('a[href]') || article;
                    const descEl = article.querySelector('p.description, .description, .sapo, .lead') || '';
                    const imgEl = article.querySelector('img[src]');
                    
                    const title = titleEl?.textContent?.trim() || '';
                    const link = linkEl?.href ? new URL(linkEl.href, categoryUrl).href : '';
                    const description = descEl?.textContent?.trim() || '';
                    const image = imgEl?.src || '';

                    if (!title || !link) return null;

                    return {
                        title,
                        url: link,
                        description,
                        image,
                        source: 'vnexpress',
                        category: currentCategory
                    };
                } catch (error) {
                    console.error('Error processing article:', error);
                    return null;
                }
            }).filter(article => article !== null);
        }, category, url);

        // Limit to 15 articles and log the result
        const result = articles.slice(0, 15);
        console.log(`Successfully scraped ${result.length} articles for category: ${category}`);
        return result;
        
    } catch (error) {
        console.error(`Error scraping category ${category}:`, error);
        throw error;
        
    } finally {
        try {
            if (page && !page.isClosed()) {
                await page.close();
            }
        } catch (e) {
            console.error('Error closing page:', e);
        }
    }
}

module.exports = { scrapeArticle, scrapeCategory };
