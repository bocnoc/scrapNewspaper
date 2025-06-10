document.addEventListener('DOMContentLoaded', function() {
    // DOM Elements
    const urlInput = document.getElementById('article-url');
    const fetchButton = document.getElementById('fetch-article');
    const sourcesContainer = document.getElementById('sources-container');
    const articleContent = document.getElementById('article-content');
    const articleTitle = document.getElementById('article-title');
    const articleBody = document.getElementById('article-body');
    const originalLink = document.getElementById('original-link');
    const backButton = document.getElementById('back-to-sources');
    
    // Track the current article being viewed
    let currentArticle = null;

    // Load popular news sources
    loadPopularSources();

    // Event Listeners
    fetchButton.addEventListener('click', fetchArticle);
    urlInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            fetchArticle();
        }
    });

    backButton.addEventListener('click', function(e) {
        e.preventDefault();
        showSourcesView();
    });

    // Add click event for VnExpress categories
    document.querySelectorAll('.category-card').forEach(card => {
        card.addEventListener('click', function(e) {
            e.preventDefault();
            const category = this.getAttribute('data-category');
            if (category) {
                fetchArticlesByCategory(category);
            }
        });
    });

    // Load popular news sources
    async function loadPopularSources() {
        try {
            const response = await fetch('/api/popular-sources');
            const data = await response.json();
            
            if (data.sources && data.sources.length > 0) {
                renderSources(data.sources);
            } else {
                sourcesContainer.innerHTML = '<div class="error">Không thể tải danh sách báo. Vui lòng thử lại sau.</div>';
            }
        } catch (error) {
            console.error('Error loading sources:', error);
            sourcesContainer.innerHTML = '<div class="error">Đã xảy ra lỗi khi tải danh sách báo.</div>';
        }
    }

    // Render news sources
    function renderSources(sources) {
        sourcesContainer.innerHTML = sources.map(source => `
            <a href="#" class="source-card" data-url="${source.url}">
                <div class="source-logo">
                    <img src="${source.logo}" alt="${source.name}" loading="lazy">
                </div>
                <div class="source-info">
                    <div class="source-name">${source.name}</div>
                    <div class="source-url">${new URL(source.url).hostname}</div>
                </div>
            </a>
        `).join('');

        // Add click event to source cards
        document.querySelectorAll('.source-card').forEach(card => {
            card.addEventListener('click', function(e) {
                e.preventDefault();
                const url = this.getAttribute('data-url');
                if (url) {
                    urlInput.value = url;
                    fetchArticle();
                }
            });
        });
    }

    // Fetch and display article content
    async function fetchArticle(articleUrl) {
        const url = articleUrl || urlInput.value.trim();
        
        if (!url) {
            alert('Vui lòng nhập URL bài báo');
            return;
        }

        try {
            // Show loading state
            fetchButton.disabled = true;
            fetchButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang tải...';
            
            const response = await fetch('/api/fetch-article', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ url })
            });

            const data = await response.json();
            
            if (response.ok) {
                // Update the current article
                currentArticle = {
                    url: url,
                    title: data.title
                };
                
                displayArticle(data);
            } else {
                throw new Error(data.error || 'Không thể tải bài báo');
            }
        } catch (error) {
            console.error('Error fetching article:', error);
            alert('Đã xảy ra lỗi khi tải bài báo: ' + (error.message || 'Vui lòng thử lại sau.'));
        } finally {
            // Reset button state
            fetchButton.disabled = false;
            fetchButton.innerHTML = '<i class="fas fa-search"></i> Đọc báo';
        }
    }

    // Display article content
    function displayArticle(article) {
        // Update UI
        articleTitle.textContent = article.title || 'Không có tiêu đề';
        originalLink.href = article.url;
        
        // Format and display content
        let content = article.content || '';
        
        if (!content) {
            articleBody.innerHTML = '<p>Không thể tải nội dung. Vui lòng thử lại hoặc xem bài gốc.</p>';
            return;
        }
        
        // Add click handlers for category links and tags
        setTimeout(() => {
            // Handle inline category links
            document.querySelectorAll('.category-link').forEach(link => {
                link.addEventListener('click', function(e) {
                    e.preventDefault();
                    const category = this.getAttribute('data-category');
                    if (category) {
                        fetchArticlesByCategory(category);
                    }
                });
            });

            // Handle category tags from navigation
            document.querySelectorAll('.category-tag').forEach(tag => {
                tag.addEventListener('click', function(e) {
                    e.preventDefault();
                    const categoryUrl = this.getAttribute('data-url');
                    if (categoryUrl) {
                        // Navigate to the category page directly
                        window.open(categoryUrl, '_blank');
                    }
                });
            });
        }, 100);
        
        // First, try to split by common paragraph separators
        let paragraphs = [];
        
        // Try different splitting methods
        if (content.includes('\n\n')) {
            paragraphs = content.split('\n\n');
        } else if (content.includes('\n')) {
            paragraphs = content.split('\n');
        } else if (content.includes('.  ')) {
            // Some sites use double space after sentences
            paragraphs = content.split('.  ').map(p => p.trim() + '.');
        } else {
            // If no clear paragraph breaks, just use the whole content
            paragraphs = [content];
        }
        
        // Clean and format paragraphs
        const formattedContent = paragraphs
            .map(p => p.trim())
            .filter(p => p.length > 20) // Filter out very short paragraphs
            .map(p => {
                // Clean up the paragraph
                p = p.replace(/\s+/g, ' ')  // Replace multiple spaces with single space
                     .replace(/^\s*[\-•*]\s*/, '') // Remove bullet points
                     .replace(/\s+([.,!?])/g, '$1') // Fix spaces before punctuation
                     .replace(/([^.!?])\s+([A-Z])/g, '$1. $2'); // Add missing periods between sentences
                
                // Ensure the paragraph starts with a capital letter and ends with punctuation
                if (p.length > 0) {
                    p = p.charAt(0).toUpperCase() + p.slice(1);
                    if (!/[.!?]$/.test(p)) {
                        p += '.';
                    }
                }
                
                return p;
            })
            .filter(p => p.length > 20) // Filter again after cleaning
            .map(p => `<p>${p}</p>`)
            .join('\n');
        
        // Add read more link
        const readMoreLink = `
            <div class="read-more-container">
                <a href="${article.url}" class="read-more-link" target="_blank">
                    <i class="fas fa-book-open"></i>
                    Đọc tiếp trên trang gốc
                </a>
            </div>
        `;

        // If we still don't have enough content, show a message
        if (formattedContent.length < 100) {
            articleBody.innerHTML = `
                <div class="warning">
                    <p>Không thể tải đầy đủ nội dung. Vui lòng xem bài gốc hoặc thử lại.</p>
                    <p>Nếu vấn đề vẫn tiếp diễn, vui lòng thử với một URL khác.</p>
                </div>
                <div class="original-content">
                    <h3>Nội dung gốc:</h3>
                    <p>${content.substring(0, 2000)}${content.length > 2000 ? '...' : ''}</p>
                    ${readMoreLink}
                </div>
            `;
        } else {
            articleBody.innerHTML = `${formattedContent}${readMoreLink}`;
        }
        
        // Show article view and hide sources
        showArticleView();
    }

// Render news sources
function renderSources(sources) {
    sourcesContainer.innerHTML = sources.map(source => `
        <a href="#" class="source-card" data-url="${source.url}">
            <div class="source-logo">
                <img src="${source.logo}" alt="${source.name}" loading="lazy">
            </div>
            <div class="source-info">
                <div class="source-name">${source.name}</div>
                <div class="source-url">${new URL(source.url).hostname}</div>
            </div>
        </a>
    `).join('');

    // Add click event to source cards
    document.querySelectorAll('.source-card').forEach(card => {
        card.addEventListener('click', function(e) {
            e.preventDefault();
            const url = this.getAttribute('data-url');
            if (url) {
                urlInput.value = url;
                fetchArticle();
            }
        });
    });
}

// Fetch articles by category
async function fetchArticlesByCategory(category) {
    try {
        // Show loading state in article body
        articleBody.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Đang tải bài viết...</div>';
        showArticleView();
        
        // Find the clicked category card
        const clickedCard = document.querySelector(`.category-card[data-category="${category}"]`);
        let originalHTML = '';
        
        if (clickedCard) {
            originalHTML = clickedCard.innerHTML;
            clickedCard.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang tải...';
            clickedCard.style.pointerEvents = 'none';
        }
        
        try {
            const response = await fetch(`/api/category/${encodeURIComponent(category)}`);
            const data = await response.json();
            
            if (response.ok) {
                displayCategoryArticles(data);
                // Update URL to include category
                window.history.pushState({ category: category }, '', `?category=${category}`);
            } else {
                throw new Error(data.error || 'Không thể tải danh sách bài viết');
            }
        } finally {
            // Reset button state if card was found
            if (clickedCard) {
                clickedCard.innerHTML = originalHTML;
                clickedCard.style.pointerEvents = 'auto';
            }
        }
    } catch (error) {
        console.error('Error fetching category articles:', error);
        articleBody.innerHTML = `
            <div class="error">
                <i class="fas fa-exclamation-triangle"></i>
                <p>${error.message || 'Có lỗi xảy ra khi tải danh sách bài viết'}</p>
                <button class="back-button" onclick="window.history.back()">
                    <i class="fas fa-arrow-left"></i> Quay lại
                </button>
            </div>`;
    }
}

// Display articles from a VnExpress category
function displayCategoryArticles(data) {
    const { category, articles, source } = data;
    
    // Create container for articles
    const container = document.createElement('div');
    container.className = 'articles-container';
    
    // Create header with category name and back button
    const header = document.createElement('div');
    header.className = 'articles-header';
    
    const backButton = document.createElement('button');
    backButton.className = 'back-button';
    backButton.innerHTML = '<i class="fas fa-arrow-left"></i> Quay lại';
    backButton.onclick = showSourcesView;
    
    const title = document.createElement('h2');
    title.textContent = category || 'Chuyên mục';
    
    const sourceLink = document.createElement('a');
    sourceLink.href = source || '#';
    sourceLink.target = '_blank';
    sourceLink.className = 'source-link';
    sourceLink.innerHTML = '<i class="fas fa-external-link-alt"></i> Xem trên VnExpress';
    
    header.appendChild(backButton);
    header.appendChild(title);
    header.appendChild(sourceLink);
    
    // Create articles grid
    const articlesGrid = document.createElement('div');
    articlesGrid.className = 'articles-grid';
    
    if (!articles || articles.length === 0) {
        articlesGrid.innerHTML = `
            <div class="no-articles">
                <i class="far fa-newspaper"></i>
                <p>Không tìm thấy bài viết nào trong chuyên mục này</p>
            </div>`;
    } else {
        // Add each article to the grid
        articles.forEach(article => {
            if (!article.url) return;
            
            const articleEl = document.createElement('article');
            articleEl.className = 'article-card';
            
            let imageHtml = '';
            if (article.image) {
                imageHtml = `
                    <div class="article-image">
                        <img src="${article.image}" alt="${article.title || ''}" loading="lazy">
                    </div>`;
            }
            
            articleEl.innerHTML = `
                <div class="article-content">
                    <h3 class="article-title">
                        <a href="${article.url}" target="_blank">
                            ${article.title || 'Không có tiêu đề'}
                        </a>
                    </h3>
                    ${article.description ? `<p class="article-description">${article.description}</p>` : ''}
                    <a href="${article.url}" target="_blank" class="read-more">
                        Đọc tiếp <i class="fas fa-arrow-right"></i>
                    </a>
                </div>`;
                
            articlesGrid.appendChild(articleEl);
        });
    }
    
    // Add all elements to container
    container.appendChild(header);
    container.appendChild(articlesGrid);
    
    // Update the article body
    articleTitle.textContent = category ? `Chuyên mục: ${category}` : 'Chuyên mục';
    articleBody.innerHTML = '';
    articleBody.appendChild(container);
    
    // Add click event for article cards
    container.querySelectorAll('.article-card').forEach(card => {
        card.addEventListener('click', (e) => {
            // Only navigate if the click wasn't on a link
            if (e.target.tagName !== 'A') {
                const link = card.querySelector('a[target="_blank"]');
                if (link) {
                    window.open(link.href, '_blank');
                }
            }
        });
    });
}

// Show article view
function showArticleView() {
    document.querySelector('.url-input-section').style.display = 'none';
    document.querySelector('.popular-sources').style.display = 'none';
    articleContent.style.display = 'block';
    
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Show sources view
function showSourcesView() {
    document.querySelector('.url-input-section').style.display = 'block';
    document.querySelector('.popular-sources').style.display = 'block';
    articleContent.style.display = 'none';
    
    // Clear input and scroll to top
    urlInput.value = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
    
// Handle back button (browser back/forward)

    
// Handle back button (browser back/forward)
window.addEventListener('popstate', function(event) {
    if (articleContent.style.display === 'block') {
        showSourcesView();
    }
});

});
