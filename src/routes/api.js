const express = require('express');
const NodeCache = require('node-cache');
const { scrapeArticle, scrapeCategory } = require('../services/scraper');
const { CATEGORY_MAP } = require('../config/constants');

const router = express.Router();
const articleCache = new NodeCache({ stdTTL: 900, checkperiod: 120 });
const categoryCache = new NodeCache({ stdTTL: 900, checkperiod: 120 });

router.post('/fetch-article', async (req, res) => {
    const { url } = req.body;
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    const cachedArticle = articleCache.get(url);
    if (cachedArticle) {
        console.log(`Cache hit for article: ${url}`);
        return res.json(cachedArticle);
    }

    try {
        console.log(`Fetching article: ${url}`);
        const articleData = await scrapeArticle(url);
        articleCache.set(url, articleData);
        res.json(articleData);
    } catch (error) {
        console.error('Error fetching article:', error);
        res.status(500).json({ error: 'Failed to fetch article', details: error.message });
    }
});

router.get('/category/:category', async (req, res) => {
    const { category } = req.params;
    if (!CATEGORY_MAP[category]) {
        return res.status(400).json({ error: 'Invalid category' });
    }

    const cachedArticles = categoryCache.get(category);
    if (cachedArticles) {
        console.log(`Cache hit for category: ${category}`);
        return res.json(cachedArticles);
    }

    try {
        console.log(`Fetching category: ${category}`);
        const articles = await scrapeCategory(category);
        categoryCache.set(category, articles);
        res.json(articles);
    } catch (error) {
        console.error('Error fetching category:', error);
        res.status(500).json({ error: 'Failed to fetch category', details: error.message });
    }
});

module.exports = router;
