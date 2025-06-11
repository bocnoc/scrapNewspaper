const express = require('express');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const path = require('path');
const NodeCache = require('node-cache');

// Initialize caches with 15 minutes TTL
const articleCache = new NodeCache({ stdTTL: 900, checkperiod: 120 });
const categoryCache = new NodeCache({ stdTTL: 900, checkperiod: 120 });
const BROWSER_OPTIONS = {
    headless: 'new',
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-zygote',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-blink-features=AutomationControlled'
    ],
    defaultViewport: { width: 1280, height: 800 }
};

// Reuse browser instance
let browserInstance = null;

async function getBrowser() {
    if (!browserInstance) {
        browserInstance = await puppeteer.launch(BROWSER_OPTIONS);
        // Handle browser disconnection
        browserInstance.on('disconnected', () => {
            browserInstance = null;
        });
    }
    return browserInstance;
}

const app = express();
const PORT = process.env.PORT || 3000;

// Chỉ lắng nghe nếu không chạy trong môi trường Lambda
if (process.env.NODE_ENV !== 'production' || process.env.IS_LOCAL) {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

// Sample category mapping for popular Vietnamese news sites
const CATEGORY_MAPPING = {
    'kinh doanh': ['/kinh-doanh', '/tai-chinh', '/thi-truong'],
    'thế giới': ['/the-gioi', '/quoc-te', '/the-gioi-24h'],
    'thể thao': ['/the-thao', '/bong-da', '/tennis', '/bong-da-quoc-te'],
    'công nghệ': ['/cong-nghe', '/so-hoa', '/cong-nghe-thong-tin'],
    'giáo dục': ['/giao-duc', '/tuyen-sinh', '/du-hoc'],
    'sức khỏe': ['/suc-khoe', '/khoe-dep', '/song-khoe'],
    'pháp luật': ['/phap-luat', '/an-ninh-hinh-su', '/phap-dinh'],
    'giải trí': ['/giai-tri', '/sao-viet', '/sao-chau-a', '/sau-anh'],
    'đời sống': ['/doi-song', '/gia-dinh', '/tinh-yeu-gioi-tinh']
};

// Function to detect category from URL
function detectCategoryFromUrl(url) {
    const urlObj = new URL(url);
    const path = urlObj.pathname.toLowerCase();
    
    for (const [category, patterns] of Object.entries(CATEGORY_MAPPING)) {
        if (patterns.some(pattern => path.includes(pattern))) {
            return category;
        }
    }
    return null;
}

// Middleware
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API endpoint to fetch article content
app.post('/api/fetch-article', async (req, res) => {
    let browser;
    let page;
    try {
        let { url } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: 'Vui lòng cung cấp URL' });
        }

        // Clean up the URL
        url = url.trim().split('#')[0];
        if (!url.startsWith('http')) {
            url = 'https://' + url.replace(/^\/\//, '');
        }

        console.log(`Fetching article from: ${url}`);

        // Check cache first
        const cacheKey = `article:${url}`;
        const cachedData = articleCache.get(cacheKey);
        if (cachedData) {
            console.log('Serving from cache:', url);
            return res.json(cachedData);
        }

        // Get browser instance (reuse existing or create new)
        browser = await getBrowser();
        page = await browser.newPage();
        
        // Set up request interception to block unnecessary resources
        await page.setRequestInterception(true);
        const blockedResources = ['image', 'stylesheet', 'font', 'media', 'other'];
        page.on('request', (req) => {
            if (blockedResources.includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        // Set user agent and other headers
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'vi,en-US;q=0.9,en;q=0.8',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
        });
        
        // Navigate to the URL with optimized parameters
        console.log(`Navigating to: ${url}`);
        const response = await page.goto(url, { 
            waitUntil: 'domcontentloaded',
            timeout: 15000 // 15 seconds timeout
        });

        if (!response || !response.ok()) {
            const status = response ? response.status() : 'No response';
            console.error(`Failed to load page: ${status} - ${url}`);
            throw new Error(`Không thể tải trang: Lỗi ${status}`);
        }

        // Wait for the main content to load with a shorter timeout
        try {
            await page.waitForSelector('article, .fck_detail, .content-detail, .article-content, .article-body, .article-detail, .content, main', { 
                timeout: 10000 
            });
        } catch (e) {
            console.log('Main content not found, continuing with available content');
        }
            
        // Get the main content using page.evaluate
        const articleData = await page.evaluate(() => {
            // Function to get the main content element
            const getMainContent = () => {
                const contentSelectors = [
                    'article.fck_detail',
                    'article.content-detail',
                    'article.article-detail',
                    '.fck_detail',
                    '.content-detail',
                    '.article-content',
                    '.article-body',
                    '.article_content',
                    '.entry-content',
                    '.post-content',
                    'article',
                    'main',
                    '.main-content',
                    '#main-content',
                    '#content',
                    '.content',
                    'body'
                ];

                for (const selector of contentSelectors) {
                    const el = document.querySelector(selector);
                    if (el && el.textContent.trim().length > 300) {
                        return el;
                    }
                }
                return document.body;
            };

            const mainContent = getMainContent();
            
            // Get the title
            const titleElement = document.querySelector('h1.title-detail, h1.title-news, h1.title_news_detail, h1.title_news, h1') || 
                                document.querySelector('h1') || 
                                document.querySelector('title');
            const title = titleElement ? titleElement.textContent.trim() : 'Không có tiêu đề';
            
            // Get the description
            const descriptionElement = document.querySelector('p.description, .description, .sapo, .sapo-detail, .lead, .summary') || 
                                     document.querySelector('meta[property="og:description"]') || 
                                     document.querySelector('meta[name="description"]');
            const description = descriptionElement ? (descriptionElement.content || descriptionElement.textContent).trim() : '';
            
            // Clean up the content
            const cleanElement = (element) => {
                // Clone to avoid modifying the original
                const clone = element.cloneNode(true);
                
                // Remove unwanted elements
                const selectorsToRemove = [
                    'script', 'style', 'iframe', 'noscript', 'button', 'form', 'input', 
                    'select', 'textarea', 'nav', 'header', 'footer', 'aside', 'figure',
                    '.ad', '.ads', '.advertisement', '.banner', '.social', '.share', 
                    '.comment', '.related-news', '.box-tinlienquan', '.box-ads', 
                    '.box-adv', '.box-video', '.box-comment', '.box-related', '.box-tag', 
                    '.box-news', '.box-banner', '.box-social', '.box-news-focus', 
                    '.box-category', '.box-tinlienquan', '.box-tinmoi', '.box-tinnoibat',
                    '.box-tintuc', '.box-tintucmoi', '.box-tintucnoibat', 'img', 'picture',
                    'video', 'audio', 'source', 'svg', 'canvas', 'map', 'object', 'embed'
                ];
                
                selectorsToRemove.forEach(selector => {
                    const elements = clone.querySelectorAll(selector);
                    elements.forEach(el => el.remove());
                });
                
                // Remove empty elements
                const allElements = clone.querySelectorAll('*');
                allElements.forEach(el => {
                    if (!el.textContent.trim() && el.children.length === 0) {
                        el.remove();
                    }
                });
                
                return clone.innerHTML;
            };
            
            const content = cleanElement(mainContent);
            
            return {
                title: title,
                description: description,
                content: content
            };
        });
        
        // Close the browser
        await browser.close();
        
        // Send the response
        res.json({
            title: articleData.title,
            description: articleData.description,
            content: articleData.content,
            url: url
        });
    } catch (error) {
        console.error('Lỗi khi lấy nội dung bài báo:', error);
        res.status(500).json({ error: 'Không thể lấy nội dung bài báo' });
    }
});

// Get popular news sources with their latest articles
app.get('/api/popular-sources', (req, res) => {
    const sources = [
        {
            id: 'vnexpress',
            name: 'VnExpress',
            url: 'https://vnexpress.net',
            logo: 'https://s1.vnecdn.net/vnexpress/restruct/i/v866/logo_default.jpg'
        },
        {
            id: 'dantri',
            name: 'Dân Trí',
            url: 'https://dantri.com.vn',
            logo: 'https://cdnweb.dantri.com.vn/2024/03/07/logo-dt-65-65x65.png'
        },
        {
            id: 'zingnews',
            name: 'Zing News',
            url: 'https://zingnews.vn',
            logo: 'https://static-znews.zadn.vn/images/logo-zing-home.svg'
        },
        {
            id: 'tuoitre',
            name: 'Tuổi Trẻ',
            url: 'https://tuoitre.vn',
            logo: 'https://tuoitre.urbexs.com/photo/1-0/logo-tuoi-tre-online.png'
        },
        {
            id: 'thanhnien',
            name: 'Thanh Niên',
            url: 'https://thanhnien.vn',
            logo: 'https://static.thanhnien.com.vn/Resources/Origin/Images/logo-01.png'
        }
    ];
    
    res.json({ sources });
});

// Helper function to extract article data from HTML
function extractArticles($) {
    const articles = [];
    
    // Common selectors for article elements on Vietnamese news sites
    const articleSelectors = [
        'article',
        '.item-news',
        '.news-item',
        '.list-news-subfolder .item-news',
        '.list-news .news-item',
        '.story',
        '.news-story',
        '.list-news li',
        '.list-article .article-item'
    ];
    
    // Try each selector until we find articles
    for (const selector of articleSelectors) {
        const articleElements = $(selector);
        
        if (articleElements.length > 0) {
            articleElements.each((i, el) => {
                try {
                    const $el = $(el);
                    const titleElement = $el.find('h2 a, h3 a, .title-news a, .title a').first();
                    
                    if (!titleElement.length) return;
                    
                    const title = titleElement.text().trim();
                    const url = titleElement.attr('href');
                    
                    if (!url) return;
                    
                    const description = $el.find('.description, .sapo, .lead, .summary').text().trim();
                    const image = $el.find('img').attr('src') || $el.find('img').data('src') || '';
                    
                    articles.push({
                        title,
                        url: url.startsWith('http') ? url : `https://vnexpress.net${url}`,
                        description,
                        image: image.startsWith('//') ? `https:${image}` : image.startsWith('/') ? `https://vnexpress.net${image}` : image
                    });
                } catch (e) {
                    console.error('Error processing article:', e);
                }
            });
            
            if (articles.length > 0) {
                break;
            }
        }
    }
    
    return articles;
}

// API endpoint to fetch articles by category
app.get('/api/category/:category', async (req, res) => {
    let { category } = req.params;
    
    if (!category) {
        return res.status(400).json({ error: 'Vui lòng chọn chuyên mục' });
    }

    // Clean and validate category
    category = category.trim().toLowerCase();
    
    // Check cache first
    const cacheKey = `category:${category}`;
    const cachedData = categoryCache.get(cacheKey);
    if (cachedData) {
        console.log('Serving category from cache:', category);
        return res.json(cachedData);
    }
    
    // Map category to VnExpress URL
    const categoryMap = {
        'thoi-su': 'thoi-su',
        'the-gioi': 'the-gioi',
        'kinh-doanh': 'kinh-doanh',
        'the-thao': 'the-thao',
        'giai-tri': 'giai-tri',
        'phap-luat': 'phap-luat',
        'giao-duc': 'giao-duc',
        'suc-khoe': 'suc-khoe',
        'doi-song': 'doi-song',
        'du-lich': 'du-lich',
        'khoa-hoc': 'khoa-hoc',
        'so-hoa': 'so-hoa',
        'xe': 'oto-xe-may',
        'y-kien': 'y-kien',
        'tam-su': 'tam-su'
    };

    const categoryPath = categoryMap[category] || category;
    const categoryUrl = `https://vnexpress.net/${categoryPath}`;

    console.log(`Fetching category: ${categoryUrl}`);

    let browser;
    let page;
    try {
        browser = await getBrowser();
        page = await browser.newPage();
        
        // Set up request interception to block unnecessary resources
        await page.setRequestInterception(true);
        const blockedResources = ['image', 'stylesheet', 'font', 'media', 'other'];
        page.on('request', (req) => {
            if (blockedResources.includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        // Set user agent and headers
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'vi,en-US;q=0.9,en;q=0.8',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
        });

        // Navigate to the category page
        console.log(`Navigating to: ${categoryUrl}`);
        const response = await page.goto(categoryUrl, { 
            waitUntil: 'domcontentloaded',
            timeout: 15000
        });

        if (!response || !response.ok()) {
            throw new Error(`Failed to load category page: ${response ? response.status() : 'No response'}`);
        }

        // Wait for articles to load with a shorter timeout
        try {
            await page.waitForSelector('.item-news, article, .list-news .title-news a, .title-news', { 
                timeout: 10000 
            });
        } catch (e) {
            console.log('Articles not found with primary selector, trying alternatives...');
        }

        // Extract article data with multiple fallback selectors
        const articles = await page.evaluate((category, categoryUrl) => {
            // Try multiple selectors to find articles
            const selectors = [
                '.item-news', 
                'article', 
                '.list-news .title-news a',
                '.title-news',
                'h2.title-news a',
                'h3.title-news a',
                '.title-news a',
                '.list-news .title-news',
                '.list-news h2 a',
                '.list-news h3 a'
            ];

            let articleElements = [];
            for (const selector of selectors) {
                const elements = Array.from(document.querySelectorAll(selector));
                if (elements.length > 0) {
                    articleElements = elements;
                    break;
                }
            }

            const fallbackArticles = Array.from(articleElements).map(el => {
                try {
                    const titleEl = el.querySelector('h2, h3, a') || el;
                    const link = el.href || (el.querySelector('a')?.href || '');
                    const title = titleEl?.textContent?.trim() || '';
                    
                    if (!title || !link) return null;
                    
                    return {
                        title: title,
                        url: link,
                        description: '',
                        image: ''
                    };
                } catch (e) {
                    console.error('Error processing article:', e);
                    return null;
                }
            }).filter(article => article !== null);
            
            if (fallbackArticles.length > 0) {
                console.log('Used fallback selector to find articles');
                return {
                    articles: fallbackArticles,
                    usedFallback: true
                };
            }
            
            throw new Error('Không tìm thấy bài viết nào trong chuyên mục này');
        }, category, categoryUrl);

        // Cache the result
        categoryCache.set(cacheKey, {
            category: category,
            articles: articles.articles,
            source: 'vnexpress',
            sourceName: 'VnExpress',
            sourceUrl: categoryUrl
        });

        // Return the articles in the expected format
        return res.json({
            category: category,
            articles: articles.articles,
            source: 'vnexpress',
            sourceName: 'VnExpress',
            sourceUrl: categoryUrl
        });
    } catch (error) {
        console.error('Error in page navigation or extraction:', error);
        res.status(500).json({ 
            error: 'Không thể lấy danh sách bài viết',
            details: error.message 
        });
    } finally {
        if (page) await page.close();
        if (browser) await browser.close();
    }
});

// API endpoint to fetch article content
app.get('/api/article/:url', async (req, res) => {
    const url = req.params.url;

    try {
        const browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        
        try {
            // Set a user agent to avoid being blocked
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
            
            console.log(`Attempting to fetch article: ${url}`);
            
            // Navigate to the article URL with better error handling
            console.log(`Navigating to: ${url}`);
            const response = await page.goto(url, { 
                waitUntil: 'domcontentloaded', 
                timeout: 30000
            });
            
            if (!response || !response.ok()) {
                throw new Error(`Failed to load page: ${response ? response.status() : 'No response'}`);
            }

            // Extract article data using page.evaluate
            const articleData = await page.evaluate(() => {
                // Remove unwanted elements
                const selectorsToRemove = [
                    'header', 'footer', 'iframe', 'script', 'style', 'img',
                    '.header', '.footer', '.sidebar', '.advertisement',
                    '.banner', '.comment', '.social', '.share', '.ad', '.ads',
                    '.related-news', '.box-tinlienquan', '.social-button',
                    '.box-ads', '.box-adv', '.box-video', '.box-comment',
                    '.box-related', '.box-tag', '.box-news', '.box-banner',
                    '.box-social', '.box-news-focus', '.box-category',
                    '.box-tinlienquan', '.box-tinmoi', '.box-tinnoibat',
                    '.box-tintuc', '.box-tintucmoi', '.box-tintucnoibat',
                    'figure', '.tplCaption', '.Image', '.image', '.photo'
                ];

                selectorsToRemove.forEach(selector => {
                    document.querySelectorAll(selector).forEach(el => el.remove());
                });

                // Get the main content container
                const getMainContent = () => {
                    const selectors = [
                        'article.fck_detail',
                        'article.content-detail',
                        'article.article-detail',
                        '.fck_detail',
                        '.content-detail',
                        '.article-content',
                        '.article-body',
                        '.article_content',
                        '.entry-content',
                        '.post-content',
                        'article',
                        'main',
                        '.main-content',
                        '#main-content',
                        '#content',
                        '.content',
                        'body'
                    ];

                    for (const selector of selectors) {
                        const el = document.querySelector(selector);
                        if (el && el.textContent.trim().length > 300) {
                            return el;
                        }
                    }
                    return document.body;
                };

                const mainContent = getMainContent();
                
                // Clean up the content
                const cleanElement = (element) => {
                    // Remove empty elements
                    const elements = element.querySelectorAll('*');
                    elements.forEach(el => {
                        // Remove elements with no text content or only whitespace
                        if (!el.textContent.trim() && !el.querySelector('img, iframe, video')) {
                            el.remove();
                        }
                    });
                    return element;
                };

                const cleanedContent = cleanElement(mainContent.cloneNode(true));
                
                // Extract title and description
                const title = document.querySelector('h1.title-detail, h1.title-news, h1.title_news_detail, h1.title_news')?.textContent.trim() ||
                            document.querySelector('h1')?.textContent.trim() ||
                            document.title.split('|')[0].trim();

                const description = document.querySelector('p.description, .description, .sapo, .sapo-detail, .lead')?.textContent.trim() || '';

                return {
                    title: title,
                    description: description,
                    content: cleanedContent.innerHTML
                };
            });

            // Close the browser
            await browser.close();

            // Clean up the content further
            const $ = cheerio.load(articleData.content);
            
            // Remove any remaining images
            $('img, picture, figure, .image, .photo, .tplCaption').remove();
            
            // Remove empty elements
            $('*').each(function() {
                const $el = $(this);
                if ($el.text().trim() === '' && $el.children().length === 0) {
                    $el.remove();
                }
            });
            
            // Get the final cleaned content
            const finalContent = $('body').html();

            // Send the response
            res.json({
                title: articleData.title || 'Không có tiêu đề',
                description: articleData.description || '',
                content: finalContent || 'Không thể tải nội dung bài viết',
                url: url
            });
            
        } catch (error) {
            console.error('Error fetching article:', error);
            if (browser) await browser.close();
            res.status(500).json({ 
                error: 'Không thể lấy nội dung bài viết',
                details: error.message 
            });
        }
    } catch (error) {
        console.error('Error launching browser:', error);
        res.status(500).json({ error: 'Lỗi khởi tạo trình duyệt', details: error.message });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Đã xảy ra lỗi!' });
});

app.listen(PORT, () => {
    console.log(`Máy chủ đang chạy tại http://localhost:${PORT}`);
});
