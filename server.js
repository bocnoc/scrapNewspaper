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
    try {
        const { url } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: 'Vui lòng cung cấp URL' });
        }

        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        
        try {
            // Set a user agent to avoid being blocked
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
            
            // Navigate to the URL
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
            
            // Get the page content
            const content = await page.content();
            const $ = cheerio.load(content);
            
            // Remove unwanted elements but be less aggressive
            $('script, style, iframe, noscript, button, form, input, select, textarea, [role="alert"], [role="banner"], [role="dialog"], [role="alertdialog"], [role="menubar"], [role="toolbar"]').remove();
            
            // Try to find the main article content
            let articleText = '';
            const selectors = [
                'article',
                'main',
                'div[class*="content"]',
                'div[class*="article"]',
                'div[class*="post"]',
                'div[class*="entry"]',
                'div[itemprop="articleBody"]',
                'div[role="main"]',
                'div[class*="story"]',
                'div[class*="text"]',
                'div[class*="body"]',
                'section',
                'div[class*="detail"]',
                'div[class*="main"]',
                'div[id*="content"]',
                'div[id*="article"]',
                'div[class*="news-content"]',
                'div[class*="news_detail"]',
                'div[class*="news-content"]',
                'div[class*="article-content"]'
            ];

            // Try to find the best matching element
            let bestMatch = { length: 0, text: '' };
            
            for (const selector of selectors) {
                $(selector).each(function() {
                    const text = $(this).text().trim();
                    const textLength = text.length;
                    const linkDensity = $(this).find('a').text().length / (textLength || 1);
                    
                    // If this element has more text and lower link density than our best match
                    if (textLength > 100 && textLength > bestMatch.length && linkDensity < 0.5) {
                        bestMatch = {
                            length: textLength,
                            text: text
                        };
                    }
                });
            }
            
            articleText = bestMatch.text || $('body').text().trim();
            
            // If we still don't have enough text, try to get paragraphs
            if (articleText.length < 500) {
                const paragraphs = [];
                $('p, div').each(function() {
                    const text = $(this).text().trim();
                    if (text.length > 50) {  // Only include meaningful paragraphs
                        paragraphs.push(text);
                    }
                });
                articleText = paragraphs.join('\n\n');
            }
            
            // Clean up the text
            articleText = articleText
                .replace(/\s+/g, ' ') // Replace multiple spaces with single space
                .replace(/\n+/g, '\n') // Replace multiple newlines with single newline
                .trim();

            // First, try to get the main navigation or menu
            let navigationHtml = '';
            const navSelectors = [
                'nav',
                'ul.nav',
                'div.nav',
                'div.menu',
                'div.header',
                'div.top-menu',
                'div.main-nav',
                'div[role="navigation"]'
            ];

            // Try to find navigation elements
            for (const selector of navSelectors) {
                const navElement = $(selector).first();
                if (navElement.length > 0) {
                    navigationHtml = navElement.html();
                    // Clean up the navigation HTML
                    navigationHtml = navigationHtml
                        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
                        .replace(/<img[^>]*>/gi, '')
                        .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '')
                        .replace(/<button[^>]*>[\s\S]*?<\/button>/gi, '');
                    break;
                }
            }

            // If we found navigation, use it to create category links
            let categoryLinks = [];
            if (navigationHtml) {
                // Extract links from navigation
                const $nav = $(`<div>${navigationHtml}</div>`);
                $nav.find('a').each(function() {
                    const $link = $(this);
                    const href = $link.attr('href');
                    const text = $link.text().trim();
                    
                    if (href && text && text.length < 30 && !href.startsWith('javascript:')) {
                        // Make relative URLs absolute
                        const fullUrl = new URL(href, url).href;
                        categoryLinks.push({
                            text: text,
                            url: fullUrl
                        });
                    }
                });
            }

            // Process the main content
            let processedContent = articleText;
            let allCategories = [];
            
            // Add category links from navigation
            if (categoryLinks.length > 0) {
                // Create a category links section at the top
                const categoryLinksHtml = `
                    <div class="article-categories">
                        <h3>Chuyên mục:</h3>
                        <div class="category-tags">
                            ${categoryLinks.map(link => {
                                // Extract category name from URL or use the link text
                                const categoryName = link.text;
                                allCategories.push(categoryName);
                                return `<a href="#" class="category-tag" data-url="${link.url}" data-category="${categoryName}">${categoryName}</a>`;
                            }).join('')}
                        </div>
                    </div>
                `;
                
                processedContent = categoryLinksHtml + processedContent;
                
                // Make categories unique
                allCategories = [...new Set(allCategories)];
                
                // Also add category links to the content
                allCategories.forEach(category => {
                    const regex = new RegExp(`(^|\\s)(${category})(?=[\\s.,;:!?]|$)`, 'gi');
                    processedContent = processedContent.replace(regex, 
                        ` <a href="#" class="category-link" data-category="${category}">${category}</a>`
                    );
                });
            } else {
                // Fallback to the previous category detection if no navigation found
                const detectedCategory = detectCategoryFromUrl(url);
                const contentSample = articleText.substring(0, 1000).toLowerCase();
                const foundCategories = Object.keys(CATEGORY_MAPPING).filter(
                    category => contentSample.includes(category)
                );
                
                allCategories = [...new Set([
                    ...(detectedCategory ? [detectedCategory] : []),
                    ...foundCategories
                ])];

                allCategories.forEach(category => {
                    const regex = new RegExp(`(^|\\s)(${category})(?=[\\s.,;:!?]|$)`, 'gi');
                    processedContent = processedContent.replace(regex, 
                        ` <a href="#" class="category-link" data-category="${category}">${category}</a>`
                    );
                });
            }


            await browser.close();
            
            res.json({
                title: $('title').text().trim() || 'Không có tiêu đề',
                content: processedContent,
                url: url,
                categories: allCategories
            });
            
        } catch (error) {
            await browser.close();
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
            headless: true,
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
                waitUntil: 'domcontentloaded', 
                timeout: 30000
            });
            
            if (!response || !response.ok()) {
                throw new Error(`Failed to load page: ${response ? response.status() : 'No response'}`);
            }
            
            // Wait for articles to load
            await page.waitForSelector('article.item-news, .item-news, .list-news .item-news', { timeout: 10000 })
                .catch(() => console.log('No articles found with initial selector, continuing...'));
            
            // Get the page content
            const content = await page.content();
            const $ = cheerio.load(content);
            
            // Extract the category name
            const categoryName = $('h1.title_cate, h1.title-news, .title-news h1, h1.title-detail').first().text().trim() || 
                              $('title').text().split('|')[0].trim() || 
                              category.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
            
            console.log(`Successfully loaded category: ${categoryName}`);
            
            // Extract articles using VnExpress-specific selectors
            const articles = [];
            
            // Main article container selector for VnExpress
            const articleItems = $('article.item-news, .item-news, .list-news .item-news, .list-news .news-item, .list-news .item-news-common');
            
            console.log(`Found ${articleItems.length} article elements on the page`);
            
            articleItems.each((i, el) => {
                try {
                    const $el = $(el);
                    const titleElement = $el.find('h2.title-news a, h3.title-news a, .title-news a, h2 a, h3 a, a[data-medium]').first();
                    const title = titleElement.attr('title') || titleElement.text().trim();
                    let url = titleElement.attr('href');
                    const description = $el.find('.description a, .description, .lead, .sapo').first().text().trim() || '';
                    const image = $el.find('img').attr('data-src') || $el.find('img').attr('src') || '';
                    
                    if (title && url) {
                        if (!url.startsWith('http')) {
                            url = new URL(url, 'https://vnexpress.net').href;
                        }
                        
                        // Only add if it's a VnExpress URL
                        if (url.includes('vnexpress.net')) {
                            articles.push({
                                title: title,
                                url: url,
                                description: description,
                                image: image
                            });
                        }
                    }
                } catch (error) {
                    console.error('Error processing article element:', error);
                }
            });
            
            console.log(`Successfully extracted ${articles.length} articles`);
            
            // Close the browser
            await browser.close();
            
            if (articles.length === 0) {
                console.log('No articles found, checking alternative selectors...');
                // Try alternative selectors if no articles found
                const altArticles = [];
                $('a[href*=".vnexpress.net"]').each((i, el) => {
                    const $el = $(el);
                    const title = $el.text().trim();
                    let url = $el.attr('href');
                    if (title && title.length > 20 && url && !url.includes('javascript')) {
                        if (!url.startsWith('http')) {
                            url = new URL(url, 'https://vnexpress.net').href;
                        }
                        altArticles.push({
                            title: title,
                            url: url,
                            description: '',
                            image: ''
                        });
                    }
                });
                
                console.log(`Found ${altArticles.length} articles with alternative selectors`);
                
                if (altArticles.length > 0) {
                    return res.json({
                        category: categoryName,
                        articles: altArticles,
                        source: categoryUrl,
                        rawData: altArticles,
                        fromAlternativeSelector: true
                    });
                }
            }
            
            res.json({
                category: categoryName,
                articles: articles,
                source: categoryUrl,
                rawData: articles
            });
            
        } catch (error) {
            console.error('Error in navigation or processing:', error);
            if (browser) await browser.close();
            res.status(500).json({ 
                error: 'Lỗi khi tải trang chuyên mục VnExpress', 
                details: error.message,
                url: categoryUrl
            });
        }
    } catch (error) {
        console.error('Error launching browser:', error);
        res.status(500).json({ error: 'Lỗi khởi tạo trình duyệt', details: error.message });
    }
});

// Error handling
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Đã xảy ra lỗi!' });
});

app.listen(PORT, () => {
    console.log(`Máy chủ đang chạy tại http://localhost:${PORT}`);
});
