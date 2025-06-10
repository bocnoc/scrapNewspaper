const express = require('express');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

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
    try {
        let { url } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: 'Vui lòng cung cấp URL' });
        }

        // Clean up the URL
        url = url.trim();
        // Remove any hash fragments
        url = url.split('#')[0];
        
        // Ensure the URL has a protocol
        if (!url.startsWith('http')) {
            url = 'https://' + url.replace(/^\/\//, '');
        }

        console.log(`Fetching article from: ${url}`);

        browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
            defaultViewport: { width: 1280, height: 800 }
        });

        const page = await browser.newPage();
        
        // Set user agent to avoid detection
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        // Enable request interception to block unnecessary resources
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
                req.abort();
            } else {
                req.continue();
            }
        });
        
        try {
            // Navigate to the article URL
            console.log(`Navigating to: ${url}`);
            const response = await page.goto(url, { 
                waitUntil: ['domcontentloaded', 'networkidle0'],
                timeout: 30000 // 30 seconds timeout
            });

            if (!response || !response.ok()) {
                const status = response ? response.status() : 'No response';
                console.error(`Failed to load page: ${status} - ${url}`);
                throw new Error(`Không thể tải trang: Lỗi ${status}`);
            }
            // Set a user agent to avoid being blocked
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
            
            // Wait for the main content to load
            await page.waitForSelector('article, .fck_detail, .content-detail, .article-content, .article-body, .article-detail, .content, main', { timeout: 10000 });
            
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
            if (browser) {
                await browser.close();
            }
            console.error('Lỗi khi lấy nội dung bài báo:', error);
            res.status(500).json({ error: 'Không thể lấy nội dung bài báo' });
        }
    } catch (error) {
        console.error('Lỗi:', error);
        res.status(500).json({ error: 'Lỗi máy chủ nội bộ' });
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

// Start server
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
            articleElements.each((index, element) => {
                const $article = $(element);
                let title = '';
                let url = '';
                let description = '';
                let image = '';
                
                // Try to find title and URL
                const titleElement = $article.find('h2 a, h3 a, .title-news a, .title a, .title-news').first();
                if (titleElement.length) {
                    title = titleElement.text().trim();
                    url = titleElement.attr('href') || '';
                }
                
                // Try to find description
                description = $article.find('.description, .sapo, .lead, .summary, p:first-child')
                    .first().text().trim();
                
                // Try to find image
                const imgElement = $article.find('img').first();
                if (imgElement.length) {
                    image = imgElement.attr('src') || imgElement.attr('data-src') || '';
                }
                
                // Only add if we have both title and URL
                if (title && url) {
                    // Make URL absolute if it's relative
                    if (url && !url.startsWith('http')) {
                        url = new URL(url, 'https://vnexpress.net').href;
                    }
                    
                    articles.push({
                        title: title,
                        url: url,
                        description: description,
                        image: image
                    });
                }
            });
            
            // If we found articles, break the loop
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

    // Clean and validate the category parameter
    category = category.trim().toLowerCase();
    
    // Remove any leading/trailing slashes and encode the category
    category = category.replace(/^\/+|\/+$/g, '');
    
    // Check if the category is a valid VnExpress category path
    if (!/^[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(category)) {
        return res.status(400).json({ error: 'Đường dẫn chuyên mục không hợp lệ' });
    }

    try {
        const browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        
        try {
            // Set a user agent to avoid being blocked
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
            
            // Construct VnExpress category URL with proper encoding
            const baseUrl = 'https://vnexpress.net';
            const categoryUrl = `${baseUrl}/${category}`;
            
            console.log(`Attempting to fetch category: ${categoryUrl}`);
            
            // Navigate to the category URL with better error handling
            console.log(`Navigating to: ${categoryUrl}`);
            const response = await page.goto(categoryUrl, { 
                waitUntil: 'networkidle2',
                timeout: 30000
            });
            
            if (!response || !response.ok()) {
                throw new Error(`Failed to load page: ${response ? response.status() : 'No response'}`);
            }
            
            // Wait for the article list to load with a longer timeout
            await page.waitForSelector('article.item-news', { timeout: 15000 })
                .catch(() => console.log('Article list not found, trying to continue...'));

            // Extract the articles using page.evaluate
            const articles = await page.evaluate(() => {
                const articleElements = Array.from(document.querySelectorAll('article.item-news'));
                return articleElements.map(article => {
                    const titleElement = article.querySelector('h2.title-news a, h3.title-news a, h2.title-news a, h3.title-news a');
                    const descriptionElement = article.querySelector('.description a, .description');
                    const imageElement = article.querySelector('.thumb-art img, .thumb-art picture img, img.thumb, img[data-src]');
                    
                    // Get URL from data-src if available, otherwise use src
                    let imageUrl = '';
                    if (imageElement) {
                        imageUrl = imageElement.getAttribute('data-src') || 
                                 imageElement.getAttribute('src') || '';
                        // Convert to full URL if it's a relative path
                        if (imageUrl.startsWith('//')) {
                            imageUrl = 'https:' + imageUrl;
                        } else if (imageUrl.startsWith('/')) {
                            imageUrl = 'https://vnexpress.net' + imageUrl;
                        }
                    }
                    
                    // Get the article URL
                    let articleUrl = '';
                    if (titleElement && titleElement.href) {
                        articleUrl = titleElement.href;
                    } else if (article.querySelector('a')) {
                        articleUrl = article.querySelector('a').href;
                    }
                    
                    // Get title text
                    let titleText = 'Không có tiêu đề';
                    if (titleElement && titleElement.textContent) {
                        titleText = titleElement.textContent.trim();
                    } else if (article.querySelector('h2, h3')) {
                        titleText = article.querySelector('h2, h3').textContent.trim();
                    }
                    
                    // Get description text
                    let descriptionText = '';
                    if (descriptionElement && descriptionElement.textContent) {
                        descriptionText = descriptionElement.textContent.trim();
                    }
                    
                    return {
                        title: titleText,
                        url: articleUrl,
                        description: descriptionText,
                        image: imageUrl,
                        source: 'VnExpress',
                        time: '' // We'll leave this empty for now
                    };
                }).filter(article => article.url); // Filter out articles without URLs
            });

            if (!articles || articles.length === 0) {
                // Try an alternative selector if no articles found
                const fallbackArticles = await page.evaluate(() => {
                    const items = Array.from(document.querySelectorAll('.item-news, .item-news-common, .list-news-subfolder .item-news, .list-news-subfolder .item-news-common'));
                    return items.map(item => {
                        const titleEl = item.querySelector('h2 a, h3 a, h2.title-news a, h3.title-news a, a.title-news, .title-news a');
                        const descEl = item.querySelector('.description, .description a, .sapo, .sapo a');
                        const imgEl = item.querySelector('img[data-src], img[src]');
                        
                        let imgUrl = '';
                        if (imgEl) {
                            imgUrl = imgEl.getAttribute('data-src') || imgEl.getAttribute('src') || '';
                            if (imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl;
                            else if (imgUrl.startsWith('/')) imgUrl = 'https://vnexpress.net' + imgUrl;
                        }
                        
                        return {
                            title: titleEl ? titleEl.textContent.trim() : 'Không có tiêu đề',
                            url: titleEl ? titleEl.href : (item.querySelector('a') ? item.querySelector('a').href : ''),
                            description: descEl ? descEl.textContent.trim() : '',
                            image: imgUrl,
                            source: 'VnExpress',
                            time: ''
                        };
                    }).filter(article => article.url);
                });
                
                if (fallbackArticles && fallbackArticles.length > 0) {
                    console.log('Used fallback selector to find articles');
                    return res.json({
                        category: category,
                        articles: fallbackArticles,
                        source: 'vnexpress',
                        sourceName: 'VnExpress',
                        sourceUrl: categoryUrl
                    });
                }
                
                throw new Error('Không tìm thấy bài viết nào trong chuyên mục này');
            }

            // Return the articles in the expected format
            res.json({
                category: category,
                articles: articles,
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
            await page.close();
            await browser.close();
        }
    } catch (error) {
        console.error('Error launching browser:', error);
        res.status(500).json({ 
            error: 'Lỗi khởi tạo trình duyệt', 
            details: error.message 
        });
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
